<?php
/**
 * Plugin Name: MAHAK Stock Sync
 * Description: Stock-only bridge for MAHAK desktop app and WooCommerce. It reads/writes only stock_quantity and never exposes prices, customers, orders totals or addresses.
 * Version: 1.1.0
 * Author: MAHAK Local
 */

if (!defined('ABSPATH')) exit;

final class Mahak_Stock_Sync_Plugin {
  const VERSION = '1.1.0';
  const DB_VERSION = '4';
  const OPTION_TOKEN = 'mahak_stock_sync_token';
  const OPTION_LAST_SECRET_HINT = 'mahak_stock_sync_secret_hint';
  const OPTION_DB_VERSION = 'mahak_stock_sync_db_version';
  const TRANSIENT_TOKEN_PREFIX = 'mahak_stock_sync_token_';
  const TABLE = 'mahak_stock_journal';
  private static $suppress = false;
  private static $suppress_ids = array();
  private static $request_id = null;
  private static $before = array();
  private static $meta_recorded = array();
  private static $hook_locks = array();
  private static $lock_missed = array();
  private static $order_id = null;
  private static $order_source = 'order';
  // seq ردیف journal ساخته‌شده در همین request، به‌کلید holder؛ برای tagging دقیق order/refund روی همان ردیف.
  private static $last_event_seq = array();

  public static function init() {
    self::maybe_upgrade();
    add_action('rest_api_init', array(__CLASS__, 'routes'));
    add_action('admin_menu', array(__CLASS__, 'admin_menu'));
    add_action('admin_post_mahak_stock_sync_save', array(__CLASS__, 'save_settings'));

    add_action('woocommerce_product_before_set_stock', array(__CLASS__, 'before_stock'), 10, 1);
    add_action('woocommerce_variation_before_set_stock', array(__CLASS__, 'before_stock'), 10, 1);
    add_action('pre_post_update', array(__CLASS__, 'before_post_update'), 10, 1);
    add_action('woocommerce_product_set_stock', array(__CLASS__, 'after_stock'), 10, 1);
    add_action('woocommerce_variation_set_stock', array(__CLASS__, 'after_stock'), 10, 1);
    add_action('updated_post_meta', array(__CLASS__, 'after_stock_meta'), 10, 4);
    add_action('added_post_meta', array(__CLASS__, 'after_stock_meta'), 10, 4);

    // هنگام کم/زیاد شدن موجودی به‌خاطر سفارش، همان hook عمومی stock را با source=order ثبت می‌کنیم؛
    // event جداگانه‌ی order نمی‌سازیم تا موجودی در MAHAK دوبار اعمال نشود.
    add_filter('woocommerce_can_reduce_order_stock', array(__CLASS__, 'mark_reduce_order_context'), PHP_INT_MAX, 2);
    add_action('woocommerce_reduce_order_stock', array(__CLASS__, 'clear_order_context'), PHP_INT_MAX, 1);
    add_filter('woocommerce_can_restore_order_stock', array(__CLASS__, 'mark_restore_order_context'), PHP_INT_MAX, 2);
    add_action('woocommerce_restore_order_stock', array(__CLASS__, 'clear_order_context'), PHP_INT_MAX, 1);
    add_action('woocommerce_reduce_order_item_stock', array(__CLASS__, 'tag_reduce_order_item_event'), 999, 10);
    add_action('woocommerce_restore_order_item_stock', array(__CLASS__, 'tag_restore_order_item_event'), 999, 10);
    add_action('woocommerce_restock_refunded_item', array(__CLASS__, 'mark_refund_context'), 999, 10);
    add_action('shutdown', array(__CLASS__, 'shutdown_cleanup'), 999);
  }

  private static function table_exists($table) {
    global $wpdb;
    $found = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table)));
    return is_string($found) && strcasecmp($found, $table) === 0;
  }

  private static function quoted_table($table) {
    return '`' . str_replace('`', '``', $table) . '`';
  }

  private static function request_holder_unique_exists($table) {
    global $wpdb;
    return (int)$wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = %s AND index_name = 'request_holder' AND non_unique = 0", $table)) > 0;
  }

  private static function request_holder_non_unique_exists($table) {
    global $wpdb;
    return (int)$wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = %s AND index_name = 'request_holder' AND non_unique = 1", $table)) > 0;
  }

  private static function prepare_request_holder_index($table) {
    global $wpdb;
    if (!self::table_exists($table)) return;
    $qt = self::quoted_table($table);
    // نسخه‌های قبلی ممکن بود request_id خالی بسازند؛ UNIQUE روی رشته خالی مثل NULL نیست.
    $wpdb->query("UPDATE {$qt} SET request_id = NULL WHERE request_id = ''");
    // اگر نسخه قبلی در race ردیف تکراری برای یک request/holder ساخته باشد، قبل از UNIQUE کردن
    // فقط request_id ردیف‌های تکراری را یکتا می‌کنیم تا خود eventهای journal حذف نشوند.
    $wpdb->query("UPDATE {$qt} j JOIN (
      SELECT request_id, holder_key, MIN(seq) AS keep_seq
      FROM {$qt}
      WHERE request_id IS NOT NULL AND request_id <> ''
      GROUP BY request_id, holder_key
      HAVING COUNT(*) > 1
    ) d ON j.request_id = d.request_id AND j.holder_key = d.holder_key
    SET j.request_id = CONCAT(SUBSTRING(j.request_id, 1, 80), '#dup-', j.seq)
    WHERE j.seq <> d.keep_seq");
    if (self::request_holder_non_unique_exists($table) && !self::request_holder_unique_exists($table)) {
      $wpdb->query("ALTER TABLE {$qt} DROP INDEX request_holder");
    }
  }

  private static function install_schema() {
    global $wpdb;
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    $table = self::table();
    self::prepare_request_holder_index($table);
    $charset = $wpdb->get_charset_collate();
    dbDelta("CREATE TABLE {$table} (
      seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      event_uuid VARCHAR(80) NOT NULL,
      holder_key VARCHAR(80) NOT NULL,
      product_id BIGINT UNSIGNED NOT NULL,
      variation_id BIGINT UNSIGNED NULL,
      old_qty INT NULL,
      new_qty INT NOT NULL,
      delta_qty INT NOT NULL,
      source VARCHAR(50) NOT NULL DEFAULT 'woocommerce',
      order_id VARCHAR(80) NULL,
      order_item_id VARCHAR(80) NULL,
      request_id VARCHAR(120) NULL,
      created_at DATETIME NOT NULL,
      payload_json LONGTEXT NULL,
      PRIMARY KEY (seq),
      UNIQUE KEY event_uuid (event_uuid),
      UNIQUE KEY request_holder (request_id(96), holder_key(40)),
      KEY holder_seq (holder_key, seq),
      KEY request_id (request_id)
    ) {$charset};");
    if (self::request_holder_unique_exists($table)) {
      update_option(self::OPTION_DB_VERSION, self::DB_VERSION, true);
    } else {
      error_log('[mahak-stock-sync] request_holder unique index is missing after dbDelta');
    }
  }

  public static function maybe_upgrade() {
    if ((string)get_option(self::OPTION_DB_VERSION, '') === self::DB_VERSION) return;
    if (get_transient('mahak_stock_sync_upgrade_backoff')) return;
    global $wpdb;
    $lock_name = 'mahak_' . substr(md5(DB_NAME . ':' . $wpdb->prefix), 0, 12) . '_upgrade';
    $locked = (int)$wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 0)', $lock_name));
    if ($locked !== 1) return;
    try {
      self::install_schema();
      if ((string)get_option(self::OPTION_DB_VERSION, '') !== self::DB_VERSION) set_transient('mahak_stock_sync_upgrade_backoff', 1, 10 * MINUTE_IN_SECONDS);
    } catch (Throwable $e) {
      set_transient('mahak_stock_sync_upgrade_backoff', 1, 10 * MINUTE_IN_SECONDS);
      error_log('[mahak-stock-sync] upgrade failed: ' . $e->getMessage());
    } finally {
      $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock_name));
    }
  }

  public static function activate() {
    self::install_schema();
    if (!get_option(self::OPTION_TOKEN)) {
      $token = wp_generate_password(40, false, false);
      update_option(self::OPTION_TOKEN, wp_hash_password($token), false);
      update_option(self::OPTION_LAST_SECRET_HINT, 'ساخته شد؛ از دکمه ساخت کلید جدید در تنظیمات افزونه استفاده کنید.', false);
    }
  }

  private static function table() {
    global $wpdb;
    return $wpdb->prefix . self::TABLE;
  }

  private static function bearer() {
    $headers = function_exists('getallheaders') ? getallheaders() : array();
    foreach ($headers as $k => $v) {
      if (strtolower($k) === 'x-mahak-token') return trim((string)$v);
    }
    return isset($_SERVER['HTTP_X_MAHAK_TOKEN']) ? trim((string)$_SERVER['HTTP_X_MAHAK_TOKEN']) : '';
  }

  public static function auth() {
    $token = self::bearer();
    $hash = (string)get_option(self::OPTION_TOKEN, '');
    if (!$token || !$hash || !wp_check_password($token, $hash)) {
      return new WP_Error('mahak_forbidden', 'MAHAK stock sync token is invalid.', array('status' => 403));
    }
    return true;
  }

  public static function routes() {
    register_rest_route('mahak-stock/v1', '/ping', array(
      'methods' => 'GET', 'permission_callback' => array(__CLASS__, 'auth'),
      'callback' => function() { return array('ok' => true, 'plugin' => self::VERSION, 'site' => home_url(), 'time' => gmdate('c')); }
    ));
    register_rest_route('mahak-stock/v1', '/catalog', array(
      'methods' => 'GET', 'permission_callback' => array(__CLASS__, 'auth'), 'callback' => array(__CLASS__, 'catalog')
    ));
    register_rest_route('mahak-stock/v1', '/stock', array(
      'methods' => 'POST', 'permission_callback' => array(__CLASS__, 'auth'), 'callback' => array(__CLASS__, 'stock')
    ));
    register_rest_route('mahak-stock/v1', '/stock/apply', array(
      'methods' => 'POST', 'permission_callback' => array(__CLASS__, 'auth'), 'callback' => array(__CLASS__, 'apply')
    ));
    register_rest_route('mahak-stock/v1', '/journal', array(
      'methods' => 'GET', 'permission_callback' => array(__CLASS__, 'auth'), 'callback' => array(__CLASS__, 'journal')
    ));
  }

  private static function set_order_context($order, $source) {
    if ($order && is_object($order) && method_exists($order, 'get_id')) {
      self::$order_id = (string)$order->get_id();
      self::$order_source = sanitize_key($source ?: 'order');
    }
  }

  public static function mark_reduce_order_context($can, $order) {
    if ($can) self::set_order_context($order, 'order_reduce');
    return $can;
  }

  public static function mark_restore_order_context($can, $order) {
    if ($can) self::set_order_context($order, 'order_restore');
    return $can;
  }

  private static function order_id_from_args($args) {
    foreach ($args as $a) if ($a && is_object($a) && method_exists($a, 'get_id') && method_exists($a, 'get_items')) return (string)$a->get_id();
    return self::$order_id;
  }

  private static function item_from_args($args) {
    foreach ($args as $a) if ($a && is_object($a) && method_exists($a, 'get_product') && method_exists($a, 'get_quantity')) return $a;
    return null;
  }

  private static function stock_change_from_args($args) {
    foreach ($args as $a) {
      if (!is_array($a)) continue;
      $old = isset($a['from']) && is_numeric($a['from']) ? self::int_stock_value($a['from']) : null;
      $new = isset($a['to']) && is_numeric($a['to']) ? self::int_stock_value($a['to']) : null;
      $qty = isset($a['qty']) && is_numeric($a['qty']) ? intval($a['qty']) : null;
      $product = isset($a['product']) && is_object($a['product']) ? $a['product'] : null;
      return array($old, $new, $qty, $product);
    }
    return array(null, null, null, null);
  }

  private static function patch_last_order_event($source, $order_id, $item = null, $product = null, $qty = null, $old_qty = null, $new_qty = null) {
    if (!$product && $item && method_exists($item, 'get_product')) $product = $item->get_product();
    if (!$product) return;
    list($pid, $vid, $key) = self::stock_holder_parts($product);
    $item_id = ($item && method_exists($item, 'get_id')) ? (string)$item->get_id() : null;
    if ($qty === null && $item && method_exists($item, 'get_quantity')) $qty = (int)$item->get_quantity();
    $old_qty = $old_qty === null ? null : self::int_stock_value($old_qty);
    $new_qty = $new_qty === null ? null : self::int_stock_value($new_qty);
    global $wpdb;
    $payload = array('order_item_qty' => $qty === null ? null : intval($qty));
    // اگر در همین request خودمان ردیف را ساخته‌ایم، دقیقاً همان seq را tag می‌کنیم؛ جست‌وجوی heuristic «آخرین ردیف شبیه»
    // ممکن بود ردیف actor هم‌زمان دیگری (مثلاً ویرایش ادمین هم‌راستا) را اشتباه به این سفارش نسبت دهد.
    $exact_seq = isset(self::$last_event_seq[$key]) ? (int)self::$last_event_seq[$key] : 0;
    unset(self::$last_event_seq[$key]);
    $row = null;
    if ($exact_seq > 0) {
      $row = $wpdb->get_row($wpdb->prepare('SELECT seq FROM ' . self::table() . ' WHERE seq = %d AND order_item_id IS NULL LIMIT 1', $exact_seq), ARRAY_A);
    }
    if (!$row) {
      $where_order = $order_id === null ? 'order_id IS NULL' : $wpdb->prepare('(order_id = %s OR order_id IS NULL)', (string)$order_id);
      // مقدار old در hook عمومی Woo ممکن است زیر هم‌زمانی کهنه باشد؛ برای پیدا کردن ردیف، new_qty اتمیک‌تر است.
      $where_qty = '';
      if ($new_qty !== null) $where_qty .= $wpdb->prepare(' AND new_qty = %d', intval($new_qty));
      elseif ($old_qty !== null) $where_qty .= $wpdb->prepare(' AND old_qty = %d', intval($old_qty));
      $allowed_sources = $source === 'refund_restock' ? "('admin_edit','woocommerce','rest_other','order_restore','refund_restock')" : "('order','order_reduce','order_restore','woocommerce','rest_other')";
      $since = gmdate('Y-m-d H:i:s', time() - 10 * MINUTE_IN_SECONDS);
      $row = $wpdb->get_row($wpdb->prepare('SELECT seq FROM ' . self::table() . " WHERE holder_key = %s AND order_item_id IS NULL AND source IN {$allowed_sources} AND created_at >= %s {$where_qty} AND {$where_order} ORDER BY seq DESC LIMIT 1", $key, $since), ARRAY_A);
    }
    if (!$row) return;
    $data = array(
      'source' => sanitize_key($source),
      'order_id' => $order_id === null ? null : (string)$order_id,
      'order_item_id' => $item_id,
      'payload_json' => wp_json_encode($payload),
    );
    $formats = array('%s','%s','%s','%s');
    if ($old_qty !== null && $new_qty !== null) {
      $data['old_qty'] = intval($old_qty);
      $data['new_qty'] = intval($new_qty);
      $data['delta_qty'] = intval($new_qty) - intval($old_qty);
      $formats[] = '%d';
      $formats[] = '%d';
      $formats[] = '%d';
    }
    $ok = $wpdb->update(self::table(), $data, array('seq' => (int)$row['seq']), $formats, array('%d'));
    if ($ok === false && !empty($wpdb->last_error)) error_log('[mahak-stock-sync] order context patch failed: ' . $wpdb->last_error);
  }

  public static function tag_reduce_order_item_event(...$args) {
    list($old, $new, $qty, $product) = self::stock_change_from_args($args);
    self::patch_last_order_event('order_reduce', self::order_id_from_args($args), self::item_from_args($args), $product, $qty, $old, $new);
  }

  public static function tag_restore_order_item_event(...$args) {
    list($old, $new, $qty, $product) = self::stock_change_from_args($args);
    // Woo restore در بعضی نسخه‌ها scalar می‌فرستد: ($item, $new_stock, $old_stock, $order, $product).
    if ($old === null && $new === null && isset($args[1], $args[2]) && is_numeric($args[1]) && is_numeric($args[2])) {
      $new = self::int_stock_value($args[1]);
      $old = self::int_stock_value($args[2]);
      if (isset($args[4]) && is_object($args[4]) && method_exists($args[4], 'get_stock_quantity')) $product = $args[4];
      $qty = ($old !== null && $new !== null) ? abs($new - $old) : $qty;
    }
    self::patch_last_order_event('order_restore', self::order_id_from_args($args), self::item_from_args($args), $product, $qty, $old, $new);
  }

  public static function mark_refund_context(...$args) {
    $product = null;
    foreach ($args as $a) if ($a && is_object($a) && method_exists($a, 'get_stock_quantity')) $product = $a;
    if (!$product && isset($args[0])) $product = function_exists('wc_get_product') ? wc_get_product(absint($args[0])) : null;
    $old = isset($args[1]) && is_numeric($args[1]) ? intval($args[1]) : null;
    $new = isset($args[2]) && is_numeric($args[2]) ? intval($args[2]) : null;
    self::patch_last_order_event('refund_restock', self::order_id_from_args($args), self::item_from_args($args), $product, null, $old, $new);
    self::clear_order_context();
  }

  public static function clear_order_context($order = null) {
    self::$order_id = null;
    self::$order_source = 'order';
  }

  public static function shutdown_cleanup() {
    self::clear_order_context();
    self::release_hook_locks();
  }

  private static function holder_key($product_id, $variation_id = null) {
    $v = absint($variation_id);
    return $v > 0 ? 'v:' . $v : 'p:' . absint($product_id);
  }

  private static function int_stock_value($qty) {
    if ($qty === null || $qty === '') return null;
    if (!is_numeric($qty)) return null;
    $f = (float)$qty;
    if (abs($f - round($f)) > 0.000001) return null;
    return intval(round($f));
  }

  private static function request_int_value($value, $allow_negative = true) {
    if (is_bool($value) || is_array($value) || is_object($value) || $value === null) return null;
    if (is_int($value)) {
      // ستون‌های journal عدد INT (32 بیتی علامت‌دار) هستند؛ سقف عملیاتی ±۱ میلیارد هم برای موجودی واقعی کافی است
      // و هم delta هر تغییر را در محدوده‌ی قابل‌ذخیره نگه می‌دارد.
      if (abs($value) > 1000000000) return null;
      return (!$allow_negative && $value < 0) ? null : $value;
    }
    if (is_float($value)) return null;
    $s = trim((string)$value);
    $re = $allow_negative ? '/^-?\d+$/' : '/^\d+$/';
    if (!preg_match($re, $s)) return null;
    $i = intval($s);
    if (abs($i) > 1000000000) return null;
    return $i;
  }

  private static function normalize_request_id($request_id, $empty_to_null = true) {
    if ($request_id === null) return $empty_to_null ? null : '';
    // مقدار غیر scalar نباید به رشته‌ای مثل "Array" تبدیل و idempotency را روی یک کلید جعلی فروببرد.
    if (is_array($request_id) || is_object($request_id) || is_bool($request_id) || is_float($request_id)) return $empty_to_null ? null : '';
    $s = sanitize_text_field((string)$request_id);
    if ($s === '') return $empty_to_null ? null : '';
    if (strlen($s) > 96) $s = substr($s, 0, 63) . '-' . md5($s);
    return $s;
  }

  private static function is_suppressed($product) {
    if (!$product || !self::$suppress) return false;
    if (empty(self::$suppress_ids)) return true;
    return isset(self::$suppress_ids[$product->get_id()]);
  }

  private static function set_suppressed_id($product_id, $request_id = true) {
    self::$suppress = true;
    self::$suppress_ids[absint($product_id)] = $request_id;
  }

  private static function clear_suppressed_id($product_id) {
    unset(self::$suppress_ids[absint($product_id)]);
    self::$suppress = !empty(self::$suppress_ids);
  }

  private static function stock_lock_name($product_id) {
    global $wpdb;
    return 'mahak_' . substr(md5(DB_NAME . ':' . $wpdb->prefix), 0, 12) . '_stock_' . absint($product_id);
  }

  private static function acquire_hook_lock($product_id) {
    $id = absint($product_id);
    if (!$id) return false;
    if (isset(self::$hook_locks[$id])) return true;
    global $wpdb;
    $lock_name = self::stock_lock_name($id);
    $locked = (int)$wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 10)', $lock_name));
    if ($locked === 1) {
      self::$hook_locks[$id] = $lock_name;
      return true;
    }
    self::$lock_missed[$id] = true;
    error_log('[mahak-stock-sync] could not lock stock hook for product ' . $id);
    return false;
  }

  private static function release_hook_lock($product_id) {
    $id = absint($product_id);
    if (!$id || !isset(self::$hook_locks[$id])) return;
    global $wpdb;
    $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', self::$hook_locks[$id]));
    unset(self::$hook_locks[$id]);
  }

  private static function release_hook_locks() {
    foreach (array_keys(self::$hook_locks) as $id) self::release_hook_lock($id);
  }

  private static function current_db_stock_int($product) {
    if (!$product) return null;
    global $wpdb;
    $raw = $wpdb->get_var($wpdb->prepare("SELECT meta_value FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key = '_stock' ORDER BY meta_id ASC LIMIT 1", $product->get_id()));
    return $raw === null ? null : self::int_stock_value($raw);
  }

  private static function posted_stock_value_for_product($product_id) {
    $id = absint($product_id);
    if (!$id || empty($_POST)) return null;
    foreach (array('_stock', 'stock_quantity') as $key) {
      if (array_key_exists($key, $_POST)) return wp_unslash($_POST[$key]);
    }
    $variation_ids = array_key_exists('variable_post_id', $_POST) ? wp_unslash($_POST['variable_post_id']) : null;
    $variation_stock = array_key_exists('variable_stock', $_POST) ? wp_unslash($_POST['variable_stock']) : null;
    if (is_array($variation_stock)) {
      if (is_array($variation_ids)) {
        foreach ($variation_ids as $idx => $pid) {
          if (absint($pid) === $id && array_key_exists($idx, $variation_stock)) return $variation_stock[$idx];
        }
      }
      if (array_key_exists($id, $variation_stock)) return $variation_stock[$id];
    }
    return null;
  }

  private static function clean_product_caches($product) {
    if (!$product) return;
    $id = $product->get_id();
    if (function_exists('wc_delete_product_transients')) wc_delete_product_transients($id);
    if (function_exists('clean_post_cache')) clean_post_cache($id);
    if (function_exists('wp_cache_delete')) wp_cache_delete($id, 'post_meta');
    if (method_exists($product, 'get_parent_id') && $product->get_parent_id()) {
      $pid = $product->get_parent_id();
      if (function_exists('wc_delete_product_transients')) wc_delete_product_transients($pid);
      if (function_exists('clean_post_cache')) clean_post_cache($pid);
      if (function_exists('wp_cache_delete')) wp_cache_delete($pid, 'post_meta');
    }
  }

  private static function stock_holder_parts($product) {
    $is_variation = $product && $product->is_type('variation');
    $mode = self::manage_stock_mode($product);
    if ($is_variation && $mode === 'parent') {
      $pid = $product->get_parent_id();
      return array($pid, null, self::holder_key($pid, null));
    }
    $pid = $is_variation ? $product->get_parent_id() : $product->get_id();
    $vid = $is_variation ? $product->get_id() : null;
    return array($pid, $vid, self::holder_key($pid, $vid));
  }

  private static function product_from_holder($holder) {
    // شناسه‌ها باید عدد صحیح یا رشته‌ی عددی باشند؛ آرایه/آبجکت/bool/float قبل از cast دفاعی رد می‌شوند.
    foreach (array('product_id', 'variation_id') as $f) {
      if (!isset($holder[$f])) continue;
      if (!is_int($holder[$f]) && !(is_string($holder[$f]) && preg_match('/^\d+$/', trim($holder[$f])))) return null;
    }
    if (isset($holder['holder_key']) && !is_string($holder['holder_key']) && !is_int($holder['holder_key'])) return null;
    $input_product_id = isset($holder['product_id']) ? absint($holder['product_id']) : 0;
    $product_id = $input_product_id;
    $variation_id = isset($holder['variation_id']) ? absint($holder['variation_id']) : 0;
    $input_key = isset($holder['holder_key']) ? sanitize_text_field((string)$holder['holder_key']) : '';
    if (!$product_id && $input_key !== '') {
      if (strpos($input_key, 'v:') === 0) $variation_id = absint(substr($input_key, 2));
      if (strpos($input_key, 'p:') === 0) $product_id = absint(substr($input_key, 2));
    }
    $id = $variation_id ?: $product_id;
    $product = $id ? wc_get_product($id) : false;
    if (!$product) return null;
    if ($product->is_type('variation')) {
      $variation_id = $product->get_id();
      $product_id = $product->get_parent_id();
      if ($input_product_id && $input_product_id !== absint($product_id)) return null;
    } else {
      $product_id = $product->get_id();
      $variation_id = 0;
    }
    $canonical = self::holder_key($product_id, $variation_id);
    if ($input_key !== '' && $input_key !== $canonical) return null;
    return array($product, $product_id, $variation_id ?: null, $canonical);
  }

  private static function remember_qty($product, $qty = null) {
    if (!$product) return;
    $id = $product->get_id();
    $q = self::int_stock_value($qty === null ? $product->get_stock_quantity() : $qty);
    if ($q === null) return;
    update_post_meta($id, '_mahak_stock_last_qty', $q);
  }

  private static function previous_record_for_request($request_id, $holder_key, $expected = null, $target = null) {
    $request_id = self::normalize_request_id($request_id, true);
    if (!$request_id) return null;
    global $wpdb;
    $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::table() . ' WHERE request_id = %s AND holder_key = %s ORDER BY seq DESC LIMIT 1', $request_id, $holder_key), ARRAY_A);
    if (!$row) return null;
    $payload = $row['payload_json'] ? json_decode($row['payload_json'], true) : null;
    if (is_array($payload)) {
      if ($expected !== null && array_key_exists('expected', $payload) && intval($payload['expected']) !== intval($expected)) return new WP_Error('mahak_idempotency_payload_mismatch', 'request_id was reused with different expected stock.', array('status' => 409));
      if ($target !== null && array_key_exists('target', $payload) && intval($payload['target']) !== intval($target)) return new WP_Error('mahak_idempotency_payload_mismatch', 'request_id was reused with different target stock.', array('status' => 409));
    }
    return array(
      'ok' => true,
      'idempotent' => true,
      'seq' => (int)$row['seq'],
      'old_qty' => $row['old_qty'] === null ? null : (int)$row['old_qty'],
      'new_qty' => (int)$row['new_qty'],
      'holder_key' => $row['holder_key']
    );
  }

  private static function manage_stock_mode($product) {
    if (!$product) return 'no';
    if ($product->is_type('variation')) {
      // اگر WooCommerce بگوید stock این variation توسط parent مدیریت می‌شود، آن را holder مستقل نمی‌گیریم.
      if (method_exists($product, 'get_stock_managed_by_id') && (int)$product->get_stock_managed_by_id() !== (int)$product->get_id()) return 'parent';
      $raw = method_exists($product, 'get_manage_stock') ? $product->get_manage_stock('edit') : null;
      if ($raw === 'parent') return 'parent';
      if ($raw === true || $raw === 'yes') return 'yes';
      if ($raw === false || $raw === 'no') return 'no';
      $meta = get_post_meta($product->get_id(), '_manage_stock', true);
      if ($meta === 'parent') return 'parent';
      if ($meta === 'yes') return 'yes';
      if ($meta === 'no') return 'no';
    }
    return $product->managing_stock() ? 'yes' : 'no';
  }

  private static function item($product) {
    if (!$product) return null;
    $is_variation = $product->is_type('variation');
    $product_id = $is_variation ? $product->get_parent_id() : $product->get_id();
    $variation_id = $is_variation ? $product->get_id() : null;
    $manage_mode = self::manage_stock_mode($product);
    $raw_stock = $product->get_stock_quantity();
    $stock_int = ($raw_stock === null || $raw_stock === '') ? null : self::int_stock_value($raw_stock);
    if ($manage_mode === 'yes' && $stock_int === null) $manage_mode = 'fractional_unsupported';
    return array(
      'holder_key' => self::holder_key($product_id, $variation_id),
      'product_id' => (int)$product_id,
      'variation_id' => $variation_id ? (int)$variation_id : null,
      'sku' => $product->get_sku() ?: null,
      'name' => html_entity_decode(wp_strip_all_tags($product->get_name()), ENT_QUOTES, 'UTF-8'),
      'type' => $product->get_type(),
      'manage_stock' => $manage_mode === 'yes',
      'manage_stock_mode' => $manage_mode,
      'stock_quantity' => $manage_mode === 'yes' ? $stock_int : null,
      'stock_status' => (string)$product->get_stock_status(),
      'backorders' => method_exists($product, 'get_backorders') ? $product->get_backorders() : null,
      'status' => method_exists($product, 'get_status') ? $product->get_status() : null,
    );
  }

  private static function product_stock_holders($p) {
    $out = array();
    if (!$p) return $out;
    if ($p->is_type('variable')) {
      if (self::manage_stock_mode($p) === 'yes') $out[] = $p;
      foreach ($p->get_children() as $vid) {
        $v = wc_get_product($vid);
        if ($v && self::manage_stock_mode($v) !== 'parent') $out[] = $v;
      }
    } else {
      $out[] = $p;
    }
    return $out;
  }

  private static function product_items($p) {
    $out = array();
    foreach (self::product_stock_holders($p) as $holder_product) $out[] = self::item($holder_product);
    return array_values(array_filter($out));
  }

  public static function catalog(WP_REST_Request $req) {
    $limit = max(1, min(200, absint($req->get_param('limit') ?: 100)));
    $page = max(1, absint($req->get_param('page') ?: 1));
    // pageهای بسیار بزرگ همه‌ی pageهای قبلی را walk می‌کنند؛ سقف دفاعی می‌گذاریم تا درخواست عادی sync timeout نخورد.
    if ($page > 500) return new WP_Error('mahak_bad_request', 'catalog page is outside the supported range.', array('status' => 400));
    $search = sanitize_text_field((string)$req->get_param('search'));
    // page روی holderها اعمال می‌شود نه روی product خام، تا variationهای یک product در مرز صفحه گم نشوند.
    $holder_offset = ($page - 1) * $limit;
    $seen = 0;
    $items = array();
    $has_more = false;
    $product_page = 1;
    $batch = max(20, min(100, $limit));
    do {
      $args = array('limit' => $batch, 'page' => $product_page, 'status' => array('publish', 'private', 'draft'), 'return' => 'objects', 'orderby' => 'ID', 'order' => 'ASC');
      if ($search !== '') $args['search'] = $search;
      $products = wc_get_products($args);
      foreach ($products as $p) {
        foreach (self::product_stock_holders($p) as $holder_product) {
          if ($seen++ < $holder_offset) continue;
          if (count($items) >= $limit) {
            $has_more = true;
            break 3;
          }
          $items[] = self::item($holder_product);
        }
      }
      $product_page++;
    } while (is_array($products) && count($products) === $batch && $product_page < 10000);
    return array('ok' => true, 'items' => $items, 'page' => $page, 'has_more' => $has_more);
  }

  public static function stock(WP_REST_Request $req) {
    $holders = $req->get_param('holders');
    if (!is_array($holders)) $holders = array();
    // سقف دفاعی: هر holder یک lookup محصول و یک کوئری journal دارد؛ بدون سقف می‌شود worker PHP را اشغال کرد.
    if (count($holders) > 200) return new WP_Error('mahak_bad_request', 'Too many holders in one stock request (max 200).', array('status' => 400));
    $items = array();
    global $wpdb;
    foreach ($holders as $h) {
      $found = self::product_from_holder(is_array($h) ? $h : array('holder_key' => $h));
      if (!$found) continue;
      list($product, $pid, $vid, $key) = $found;
      // مثل /apply و /catalog، variationای که موجودی‌اش توسط والد مدیریت می‌شود holder مستقل معتبر نیست.
      if (self::manage_stock_mode($product) === 'parent') continue;
      $last_seq_raw = $wpdb->get_var($wpdb->prepare('SELECT MAX(seq) FROM ' . self::table() . ' WHERE holder_key = %s', $key));
      // شکست کوئری نباید مثل «journal خالی» (seq=0) به برنامه برسد؛ وگرنه drain/‌relink floor بر پایه‌ی داده‌ی نادرست ساخته می‌شود.
      if ($last_seq_raw === null && !empty($wpdb->last_error)) return new WP_Error('mahak_stock_query_failed', 'MAHAK stock journal query failed.', array('status' => 500));
      $items[] = array_merge(self::item($product), array('last_seq' => (int)$last_seq_raw));
    }
    return array('ok' => true, 'items' => $items);
  }

  public static function apply(WP_REST_Request $req) {
    $body = $req->get_json_params();
    // بدنه‌ی malformed با «محصول پیدا نشد» فرق دارد؛ 404 فقط برای holder ناشناخته‌ی معتبر است.
    if (!is_array($body)) return new WP_Error('mahak_bad_request', 'A JSON object body is required.', array('status' => 400));
    foreach (array('product_id', 'variation_id', 'holder_key') as $f) {
      if (isset($body[$f]) && !is_scalar($body[$f])) return new WP_Error('mahak_bad_request', $f . ' must be a scalar identifier.', array('status' => 400));
    }
    if (array_key_exists('request_id', $body)) {
      $rid_raw = $body['request_id'];
      // مقدار غیر integer-string روی کلید idempotency جعلی collapse می‌شود؛ باید رد شود.
      if ($rid_raw !== null && !is_string($rid_raw) && !is_int($rid_raw)) return new WP_Error('mahak_bad_request', 'request_id must be a string identifier.', array('status' => 400));
    }
    $found = self::product_from_holder($body);
    if (!$found) return new WP_Error('mahak_not_found', 'Product/variation not found.', array('status' => 404));
    list($product, $pid, $vid, $key) = $found;
    $manage_mode = self::manage_stock_mode($product);
    if ($manage_mode === 'parent') return new WP_Error('mahak_manage_stock_parent', 'Variation stock is managed by parent product.', array('status' => 409));
    if ($manage_mode !== 'yes') return new WP_Error('mahak_manage_stock_off', 'manage_stock is disabled for this holder.', array('status' => 409));
    $expected = array_key_exists('expected', $body) ? self::request_int_value($body['expected'], true) : null;
    $target = array_key_exists('target', $body) ? self::request_int_value($body['target'], false) : null;
    if ($expected === null || $target === null) {
      return new WP_Error('mahak_bad_request', 'expected and target integer fields are required.', array('status' => 400));
    }
    $request_id = self::normalize_request_id($body['request_id'] ?? '', false);
    if ($request_id === '') $request_id = wp_generate_uuid4();
    $previous = self::previous_record_for_request($request_id, $key, $expected, $target);
    if ($previous) return $previous;
    global $wpdb;
    $lock_name = self::stock_lock_name($product->get_id());
    $locked = (int)$wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 10)', $lock_name));
    if ($locked !== 1) return new WP_Error('mahak_stock_lock_timeout', 'Could not lock stock row for safe apply.', array('status' => 503));
    $connection_id = (string)$wpdb->get_var('SELECT CONNECTION_ID()');
    $in_tx = false;
    try {
      // idempotency باید بعد از گرفتن lock دوباره چک شود تا retry هم‌زمان conflict کاذب نسازد.
      $previous = self::previous_record_for_request($request_id, $key, $expected, $target);
      if ($previous) return $previous;

      if ($wpdb->query('START TRANSACTION') === false) throw new RuntimeException('Could not start MAHAK stock transaction: ' . $wpdb->last_error);
      $in_tx = true;
      $stock_row = $wpdb->get_row($wpdb->prepare("SELECT meta_id, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key = '_stock' ORDER BY meta_id ASC LIMIT 1 FOR UPDATE", $product->get_id()), ARRAY_A);
      if (!$stock_row) {
        $initial_stock = self::int_stock_value($product->get_stock_quantity());
        if ($initial_stock === null) {
          $wpdb->query('ROLLBACK');
          $in_tx = false;
          return new WP_Error('mahak_fractional_stock', 'Fractional stock is not supported by this MAHAK bridge.', array('status' => 409));
        }
        self::set_suppressed_id($product->get_id(), $request_id);
        try {
          add_post_meta($product->get_id(), '_stock', (string)$initial_stock, true);
        } finally {
          self::clear_suppressed_id($product->get_id());
        }
        $stock_row = $wpdb->get_row($wpdb->prepare("SELECT meta_id, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key = '_stock' ORDER BY meta_id ASC LIMIT 1 FOR UPDATE", $product->get_id()), ARRAY_A);
      }
      $expected_raw = $stock_row ? (string)$stock_row['meta_value'] : (string)$product->get_stock_quantity();
      $current = self::int_stock_value($expected_raw);
      if ($current === null) {
        $wpdb->query('ROLLBACK');
        $in_tx = false;
        return new WP_Error('mahak_fractional_stock', 'Fractional stock is not supported by this MAHAK bridge.', array('status' => 409));
      }
      if ($current !== $expected) {
        $wpdb->query('ROLLBACK');
        $in_tx = false;
        return new WP_REST_Response(array('ok' => false, 'code' => 'mahak_stock_conflict', 'conflict' => true, 'current' => $current, 'expected' => $expected, 'message' => 'Stock changed on WooCommerce before MAHAK apply.'), 409);
      }
      if ($current === $target) {
        self::record($pid, $vid, $current, $target, 'mahak_apply', null, null, $request_id, array('expected' => $expected, 'target' => $target), true);
        self::remember_qty($product, $target);
        if ((string)$wpdb->get_var('SELECT CONNECTION_ID()') !== $connection_id) throw new RuntimeException('MAHAK stock DB connection changed before noop commit.');
        $commit_ok = $wpdb->query('COMMIT');
        $commit_connection_id = (string)$wpdb->get_var('SELECT CONNECTION_ID()');
        $in_tx = false;
        if ($commit_ok === false) throw new RuntimeException('Could not commit MAHAK noop stock transaction: ' . $wpdb->last_error);
        if ($commit_connection_id !== $connection_id) throw new RuntimeException('MAHAK stock DB connection changed during noop commit.');
        return array('ok' => true, 'old_qty' => $current, 'new_qty' => $target, 'holder_key' => $key, 'noop' => true);
      }

      // CAS واقعی: مقدار خامِ قفل‌شده را مقایسه می‌کنیم، چون Woo ممکن است 50 را به صورت 50.000000 ذخیره کند.
      $meta_id = $stock_row && isset($stock_row['meta_id']) ? absint($stock_row['meta_id']) : 0;
      if (!$meta_id) throw new RuntimeException('MAHAK stock meta row is missing before CAS update.');
      $affected = $wpdb->query($wpdb->prepare("UPDATE {$wpdb->postmeta} SET meta_value = %s WHERE meta_id = %d AND meta_value = %s LIMIT 1", (string)$target, $meta_id, $expected_raw));
      if ($affected === false) throw new RuntimeException('MAHAK CAS update failed: ' . $wpdb->last_error);
      if ($affected !== 1) {
        $fresh = self::int_stock_value(get_post_meta($product->get_id(), '_stock', true));
        $wpdb->query('ROLLBACK');
        $in_tx = false;
        return new WP_REST_Response(array('ok' => false, 'code' => 'mahak_stock_conflict', 'conflict' => true, 'current' => $fresh, 'expected' => $expected, 'message' => 'Stock changed on WooCommerce before MAHAK apply.'), 409);
      }

      // اول journal سخت‌گیرانه ثبت می‌شود تا اگر fail شد، قبل از side-effectهای Woo rollback کنیم.
      self::record($pid, $vid, $current, $target, 'mahak_apply', null, null, $request_id, array('expected' => $expected, 'target' => $target), true);

      self::set_suppressed_id($product->get_id(), $request_id);
      self::$request_id = $request_id;
      try {
        // بعد از CAS، WooCommerce را برای stock_status، lookup table و cache همگام می‌کنیم؛ مقدار دیگر قابل replay افزایشی نیست چون set است.
        wc_update_product_stock($product, $target, 'set');
        self::remember_qty($product, $target);
      } finally {
        self::clear_suppressed_id($product->get_id());
        self::$request_id = null;
      }
      $verify_row = $wpdb->get_row($wpdb->prepare("SELECT meta_value FROM {$wpdb->postmeta} WHERE meta_id = %d LIMIT 1 FOR UPDATE", $meta_id), ARRAY_A);
      $verified = $verify_row ? self::int_stock_value($verify_row['meta_value']) : null;
      if ($verified !== $target) throw new RuntimeException('MAHAK stock apply verification failed after Woo update.');
      if ((string)$wpdb->get_var('SELECT CONNECTION_ID()') !== $connection_id) throw new RuntimeException('MAHAK stock DB connection changed before commit.');
      $journal_seq = (int)$wpdb->get_var($wpdb->prepare('SELECT seq FROM ' . self::table() . ' WHERE request_id = %s AND holder_key = %s LIMIT 1', $request_id, $key));
      if (!$journal_seq) throw new RuntimeException('MAHAK journal row missing before commit.');
      $commit_ok = $wpdb->query('COMMIT');
      $commit_connection_id = (string)$wpdb->get_var('SELECT CONNECTION_ID()');
      $in_tx = false;
      if ($commit_ok === false) throw new RuntimeException('Could not commit MAHAK stock transaction: ' . $wpdb->last_error);
      if ($commit_connection_id !== $connection_id) throw new RuntimeException('MAHAK stock DB connection changed during commit.');
      return array('ok' => true, 'old_qty' => $current, 'new_qty' => $target, 'holder_key' => $key, 'journal_seq' => $journal_seq);
    } catch (Throwable $e) {
      if ($in_tx) {
        $wpdb->query('ROLLBACK');
        $in_tx = false;
      }
      self::clear_suppressed_id($product->get_id());
      self::$request_id = null;
      self::clean_product_caches($product);
      error_log('[mahak-stock-sync] apply failed request_id=' . $request_id . ' holder=' . $key . ': ' . $e->getMessage());
      return new WP_Error('mahak_apply_failed', 'MAHAK stock apply failed. Check the WordPress error log with the request id.', array('status' => 500));
    } finally {
      if ($in_tx) $wpdb->query('ROLLBACK');
      $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock_name));
    }
  }
  public static function journal(WP_REST_Request $req) {
    global $wpdb;
    // cursor نامعتبر نباید بی‌صدا به صفر تبدیل شود؛ وگرنه کل journal از ابتدا دوباره خوانده می‌شود.
    $after_param = $req->get_param('after_seq');
    $after = 0;
    if ($after_param !== null && $after_param !== '') {
      $after = self::request_int_value($after_param, false);
      if ($after === null) return new WP_Error('mahak_bad_request', 'after_seq must be a non-negative integer.', array('status' => 400));
    }
    $limit = max(1, min(200, absint($req->get_param('limit') ?: 100)));
    $settle_cutoff = gmdate('Y-m-d H:i:s', time() - 2);
    $rows = $wpdb->get_results($wpdb->prepare('SELECT *, (created_at <= %s) AS mahak_settled FROM ' . self::table() . ' WHERE seq > %d ORDER BY seq ASC LIMIT %d', $settle_cutoff, $after, $limit), ARRAY_A);
    if ($rows === null && !empty($wpdb->last_error)) return new WP_Error('mahak_journal_query_failed', 'MAHAK journal query failed.', array('status' => 500));
    $events = array();
    foreach ($rows as $r) {
      if (empty($r['mahak_settled'])) break;
      $events[] = array(
        'seq' => (int)$r['seq'], 'event_uuid' => $r['event_uuid'], 'holder_key' => $r['holder_key'],
        'product_id' => (int)$r['product_id'], 'variation_id' => $r['variation_id'] === null ? null : (int)$r['variation_id'],
        'old_qty' => $r['old_qty'] === null ? null : (int)$r['old_qty'], 'new_qty' => (int)$r['new_qty'], 'delta' => (int)$r['delta_qty'],
        'source' => $r['source'], 'order_id' => $r['order_id'], 'order_item_id' => $r['order_item_id'], 'request_id' => $r['request_id'],
        'payload' => $r['payload_json'] ? json_decode($r['payload_json'], true) : null,
        'created_at' => $r['created_at']
      );
    }
    return array('ok' => true, 'events' => $events);
  }

  public static function before_post_update($post_id) {
    $type = get_post_type($post_id);
    if ($type !== 'product' && $type !== 'product_variation') return;
    $product = function_exists('wc_get_product') ? wc_get_product($post_id) : false;
    if (!$product || self::is_suppressed($product)) return;
    $id = $product->get_id();
    unset(self::$meta_recorded[$id]);
    if (self::manage_stock_mode($product) !== 'yes') {
      delete_post_meta($id, '_mahak_stock_last_qty');
      unset(self::$before[$id], self::$lock_missed[$id]);
      return;
    }
    $posted_stock = self::posted_stock_value_for_product($id);
    if ($posted_stock === null) {
      unset(self::$before[$id], self::$lock_missed[$id]);
      return;
    }
    self::acquire_hook_lock($id);
    $q = self::current_db_stock_int($product);
    if ($q === null) $q = self::int_stock_value($product->get_stock_quantity());
    $posted = self::int_stock_value($posted_stock);
    if ($posted === null || ($q !== null && $posted === $q)) {
      unset(self::$before[$id], self::$lock_missed[$id]);
      self::release_hook_lock($id);
      return;
    }
    if ($q !== null) self::$before[$id] = $q;
  }

  public static function before_stock($product) {
    if (!$product || self::is_suppressed($product)) return;
    $id = $product->get_id();
    unset(self::$meta_recorded[$id]);
    if (self::manage_stock_mode($product) !== 'yes') {
      delete_post_meta($id, '_mahak_stock_last_qty');
      unset(self::$before[$id], self::$lock_missed[$id]);
      return;
    }
    self::acquire_hook_lock($id);
    $q = self::current_db_stock_int($product);
    if ($q === null) $q = self::int_stock_value($product->get_stock_quantity());
    if ($q !== null) self::$before[$id] = $q;
  }

  public static function after_stock($product) {
    if (!$product || self::is_suppressed($product)) return;
    $id = $product->get_id();
    try {
      if (self::manage_stock_mode($product) !== 'yes') {
        delete_post_meta($id, '_mahak_stock_last_qty');
        unset(self::$meta_recorded[$id], self::$before[$id], self::$lock_missed[$id]);
        return;
      }
      $old = array_key_exists($id, self::$before) ? self::$before[$id] : null;
      $new = self::int_stock_value($product->get_stock_quantity());
      if ($new === null) {
        delete_post_meta($id, '_mahak_stock_last_qty');
        unset(self::$meta_recorded[$id], self::$before[$id], self::$lock_missed[$id]);
        error_log('[mahak-stock-sync] non-integer or unmanaged stock is not journaled for product ' . $id);
        return;
      }
      if (isset(self::$meta_recorded[$id])) {
        $same_meta_event = self::$meta_recorded[$id] === $new;
        unset(self::$meta_recorded[$id]);
        if ($same_meta_event) {
          unset(self::$before[$id], self::$lock_missed[$id]);
          return;
        }
      }
      if ($old === null) {
        $meta = get_post_meta($id, '_mahak_stock_last_qty', true);
        $old = ($meta === '') ? $new : self::int_stock_value($meta);
      }
      if ($old === null || $old === $new) {
        update_post_meta($id, '_mahak_stock_last_qty', $new);
        unset(self::$meta_recorded[$id], self::$before[$id], self::$lock_missed[$id]);
        return;
      }
      list($pid, $vid) = self::stock_holder_parts($product);
      $source = self::$order_id ? self::$order_source : (is_admin() ? 'admin_edit' : ((defined('REST_REQUEST') && REST_REQUEST) ? 'rest_other' : 'woocommerce'));
      $payload = isset(self::$lock_missed[$id]) ? array('lock_timeout' => true) : null;
      $recorded_seq = self::record($pid, $vid, $old, $new, $source, self::$order_id, null, null, $payload);
      if ($recorded_seq) {
        update_post_meta($id, '_mahak_stock_last_qty', $new);
        if (is_int($recorded_seq)) self::$last_event_seq[self::holder_key($pid, $vid)] = $recorded_seq;
      }
      unset(self::$meta_recorded[$id], self::$before[$id], self::$lock_missed[$id]);
      if ($source === 'refund_restock') self::clear_order_context();
    } finally {
      self::release_hook_lock($id);
    }
  }

  public static function after_stock_meta($meta_id, $object_id, $meta_key, $meta_value) {
    if ($meta_key !== '_stock') return;
    $product = function_exists('wc_get_product') ? wc_get_product($object_id) : false;
    if (!$product || self::is_suppressed($product)) return;
    $id = $product->get_id();
    self::acquire_hook_lock($id);
    try {
      if (self::manage_stock_mode($product) !== 'yes') {
        delete_post_meta($id, '_mahak_stock_last_qty');
        unset(self::$meta_recorded[$id], self::$before[$id], self::$lock_missed[$id]);
        return;
      }
      $new = self::int_stock_value($meta_value);
      if ($new === null) {
        delete_post_meta($id, '_mahak_stock_last_qty');
        unset(self::$meta_recorded[$id], self::$before[$id], self::$lock_missed[$id]);
        error_log('[mahak-stock-sync] non-integer or unmanaged stock meta is not journaled for product ' . absint($id));
        return;
      }
      $old_meta = get_post_meta($id, '_mahak_stock_last_qty', true);
      $old = array_key_exists($id, self::$before) ? self::$before[$id] : (($old_meta === '') ? null : self::int_stock_value($old_meta));
      if ($old === null || $old === $new) {
        update_post_meta($id, '_mahak_stock_last_qty', $new);
        unset(self::$meta_recorded[$id], self::$before[$id], self::$lock_missed[$id]);
        return;
      }
      list($pid, $vid) = self::stock_holder_parts($product);
      $source = self::$order_id ? self::$order_source : (is_admin() ? 'admin_edit' : ((defined('REST_REQUEST') && REST_REQUEST) ? 'rest_other' : 'woocommerce_meta'));
      $payload = array('meta_hook' => true);
      if (isset(self::$lock_missed[$id])) $payload['lock_timeout'] = true;
      $recorded_seq = self::record($pid, $vid, $old, $new, $source, self::$order_id, null, null, $payload);
      if ($recorded_seq) {
        update_post_meta($id, '_mahak_stock_last_qty', $new);
        self::$meta_recorded[$id] = $new;
        if (is_int($recorded_seq)) self::$last_event_seq[self::holder_key($pid, $vid)] = $recorded_seq;
      }
      unset(self::$before[$id], self::$lock_missed[$id]);
    } finally {
      self::release_hook_lock($id);
    }
  }

  // خروجی روی موفقیت، seq ردیف journal است تا hookهای بعدی (tagging سفارش) دقیقاً همان ردیف را پیدا کنند، نه «آخرین ردیف شبیه».
  private static function record($product_id, $variation_id, $old, $new, $source, $order_id = null, $order_item_id = null, $request_id = null, $payload = null, $strict = false) {
    $old = ($old === null) ? null : self::int_stock_value($old);
    $new = self::int_stock_value($new);
    // receipt تغییر-صفر فقط در مسیر strict (apply/noop) لازم است؛ هوک‌های عادی همچنان تغییر صفر را رد می‌کنند.
    if ($new === null || (!$strict && $old !== null && $old === $new)) return true;
    global $wpdb;
    $event_uuid = wp_generate_uuid4();
    $ok = $wpdb->insert(self::table(), array(
      'event_uuid' => $event_uuid,
      'holder_key' => self::holder_key($product_id, $variation_id),
      'product_id' => absint($product_id),
      'variation_id' => $variation_id ? absint($variation_id) : null,
      'old_qty' => $old,
      'new_qty' => $new,
      'delta_qty' => $old === null ? 0 : $new - $old,
      'source' => sanitize_key($source ?: 'woocommerce'),
      'order_id' => $order_id === null ? null : (string)$order_id,
      'order_item_id' => $order_item_id === null ? null : (string)$order_item_id,
      'request_id' => self::normalize_request_id($request_id, true),
      'created_at' => current_time('mysql', true),
      'payload_json' => $payload === null ? null : wp_json_encode($payload),
    ), array('%s','%s','%d','%d','%d','%d','%d','%s','%s','%s','%s','%s','%s'));
    if ($ok === false) {
      $msg = $wpdb->last_error ? $wpdb->last_error : 'unknown journal insert error';
      if ($strict) throw new RuntimeException('MAHAK journal insert failed: ' . $msg);
      error_log('[mahak-stock-sync] journal insert failed: ' . $msg);
      return false;
    }
    $seq = (int)$wpdb->insert_id;
    return $seq > 0 ? $seq : true;
  }

  public static function admin_menu() {
    add_submenu_page('woocommerce', 'MAHAK Stock Sync', 'محک موجودی', 'manage_woocommerce', 'mahak-stock-sync', array(__CLASS__, 'settings_page'));
  }

  public static function settings_page() {
    if (!current_user_can('manage_woocommerce')) return;
    $notice = isset($_GET['mahak_token_notice']) ? sanitize_key(wp_unslash($_GET['mahak_token_notice'])) : '';
    $new = $notice ? (string)get_transient(self::TRANSIENT_TOKEN_PREFIX . $notice) : '';
    if ($notice) delete_transient(self::TRANSIENT_TOKEN_PREFIX . $notice);
    echo '<div class="wrap"><h1>MAHAK Stock Sync</h1>';
    echo '<p>این افزونه فقط stock_quantity ووکامرس را برای برنامه محک می‌خواند/می‌نویسد. هیچ قیمت، مشتری، مبلغ سفارش یا آدرس از این API خارج نمی‌شود.</p>';
    if ($new) echo '<div class="notice notice-success"><p><strong>کلید جدید:</strong> <code style="font-size:16px">' . esc_html($new) . '</code><br>این کلید فقط همین حالا نمایش داده می‌شود؛ آن را در برنامه محک وارد کنید.</p></div>';
    echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
    wp_nonce_field('mahak_stock_sync_save');
    echo '<input type="hidden" name="action" value="mahak_stock_sync_save">';
    submit_button('ساخت کلید اتصال جدید', 'primary', 'make_token');
    echo '</form>';
    echo '<h2>آدرس‌های API</h2><code>' . esc_html(rest_url('mahak-stock/v1/ping')) . '</code>';
    echo '<p>هدر لازم: <code>X-Mahak-Token</code></p>';
    echo '</div>';
  }

  public static function save_settings() {
    if (!current_user_can('manage_woocommerce')) wp_die('Forbidden');
    check_admin_referer('mahak_stock_sync_save');
    if (isset($_POST['make_token'])) {
      $token = wp_generate_password(48, false, false);
      update_option(self::OPTION_TOKEN, wp_hash_password($token), false);
      update_option(self::OPTION_LAST_SECRET_HINT, 'آخرین کلید در ' . current_time('mysql') . ' ساخته شد.', false);
      $notice = wp_generate_password(20, false, false);
      set_transient(self::TRANSIENT_TOKEN_PREFIX . $notice, $token, 5 * MINUTE_IN_SECONDS);
      wp_safe_redirect(add_query_arg(array('page' => 'mahak-stock-sync', 'mahak_token_notice' => rawurlencode($notice)), admin_url('admin.php')));
      exit;
    }
    wp_safe_redirect(add_query_arg(array('page' => 'mahak-stock-sync'), admin_url('admin.php')));
    exit;
  }
}

register_activation_hook(__FILE__, array('Mahak_Stock_Sync_Plugin', 'activate'));
add_action('plugins_loaded', array('Mahak_Stock_Sync_Plugin', 'init'));
