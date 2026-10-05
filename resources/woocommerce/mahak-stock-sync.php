<?php
/**
 * Plugin Name: MAHAK Stock Sync
 * Description: Stock-only bridge for MAHAK desktop app and WooCommerce. It reads/writes only stock_quantity and never exposes prices, customers, orders totals or addresses.
 * Version: 1.0.0
 * Author: MAHAK Local
 */

if (!defined('ABSPATH')) exit;

final class Mahak_Stock_Sync_Plugin {
  const VERSION = '1.0.0';
  const OPTION_TOKEN = 'mahak_stock_sync_token';
  const OPTION_LAST_SECRET_HINT = 'mahak_stock_sync_secret_hint';
  const TABLE = 'mahak_stock_journal';
  private static $suppress = false;
  private static $request_id = null;
  private static $before = array();
  private static $order_id = null;

  public static function init() {
    add_action('rest_api_init', array(__CLASS__, 'routes'));
    add_action('admin_menu', array(__CLASS__, 'admin_menu'));
    add_action('admin_post_mahak_stock_sync_save', array(__CLASS__, 'save_settings'));

    add_action('woocommerce_product_before_set_stock', array(__CLASS__, 'before_stock'), 10, 1);
    add_action('woocommerce_variation_before_set_stock', array(__CLASS__, 'before_stock'), 10, 1);
    add_action('woocommerce_product_set_stock', array(__CLASS__, 'after_stock'), 10, 1);
    add_action('woocommerce_variation_set_stock', array(__CLASS__, 'after_stock'), 10, 1);

    // هنگام کم/زیاد شدن موجودی به‌خاطر سفارش، همان hook عمومی stock را با source=order ثبت می‌کنیم؛
    // event جداگانه‌ی order نمی‌سازیم تا موجودی در MAHAK دوبار اعمال نشود.
    add_filter('woocommerce_can_reduce_order_stock', array(__CLASS__, 'mark_order_context'), 999, 2);
    add_action('woocommerce_reduce_order_stock', array(__CLASS__, 'clear_order_context'), 999, 1);
    add_filter('woocommerce_can_restore_order_stock', array(__CLASS__, 'mark_order_context'), 999, 2);
    add_action('woocommerce_restore_order_stock', array(__CLASS__, 'clear_order_context'), 999, 1);
  }

  public static function activate() {
    global $wpdb;
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    $table = self::table();
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
      KEY holder_seq (holder_key, seq),
      KEY request_id (request_id)
    ) {$charset};");
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

  public static function mark_order_context($can, $order) {
    if ($can && $order && is_object($order) && method_exists($order, 'get_id')) self::$order_id = (string)$order->get_id();
    return $can;
  }

  public static function clear_order_context($order = null) {
    self::$order_id = null;
  }

  private static function holder_key($product_id, $variation_id = null) {
    $v = absint($variation_id);
    return $v > 0 ? 'v:' . $v : 'p:' . absint($product_id);
  }

  private static function product_from_holder($holder) {
    $product_id = isset($holder['product_id']) ? absint($holder['product_id']) : 0;
    $variation_id = isset($holder['variation_id']) ? absint($holder['variation_id']) : 0;
    if (!$product_id && isset($holder['holder_key'])) {
      $key = (string)$holder['holder_key'];
      if (strpos($key, 'v:') === 0) $variation_id = absint(substr($key, 2));
      if (strpos($key, 'p:') === 0) $product_id = absint(substr($key, 2));
    }
    $id = $variation_id ?: $product_id;
    $product = $id ? wc_get_product($id) : false;
    if (!$product) return null;
    if ($product->is_type('variation')) {
      $variation_id = $product->get_id();
      $product_id = $product->get_parent_id();
    } else {
      $product_id = $product->get_id();
      $variation_id = 0;
    }
    return array($product, $product_id, $variation_id ?: null, self::holder_key($product_id, $variation_id));
  }

  private static function item($product) {
    if (!$product) return null;
    $is_variation = $product->is_type('variation');
    $product_id = $is_variation ? $product->get_parent_id() : $product->get_id();
    $variation_id = $is_variation ? $product->get_id() : null;
    return array(
      'holder_key' => self::holder_key($product_id, $variation_id),
      'product_id' => (int)$product_id,
      'variation_id' => $variation_id ? (int)$variation_id : null,
      'sku' => $product->get_sku() ?: null,
      'name' => html_entity_decode(wp_strip_all_tags($product->get_name()), ENT_QUOTES, 'UTF-8'),
      'type' => $product->get_type(),
      'manage_stock' => (bool)$product->managing_stock(),
      'stock_quantity' => (int)$product->get_stock_quantity(),
      'stock_status' => (string)$product->get_stock_status(),
      'backorders' => method_exists($product, 'get_backorders') ? $product->get_backorders() : null,
      'status' => method_exists($product, 'get_status') ? $product->get_status() : null,
    );
  }

  public static function catalog(WP_REST_Request $req) {
    $limit = max(1, min(200, absint($req->get_param('limit') ?: 100)));
    $search = sanitize_text_field((string)$req->get_param('search'));
    $args = array('limit' => $limit, 'status' => array('publish', 'private', 'draft'), 'return' => 'objects');
    if ($search !== '') $args['search'] = $search;
    $products = wc_get_products($args);
    $items = array();
    foreach ($products as $p) {
      if ($p->is_type('variable')) {
        foreach ($p->get_children() as $vid) {
          $v = wc_get_product($vid);
          if ($v) $items[] = self::item($v);
        }
      } else {
        $items[] = self::item($p);
      }
      if (count($items) >= $limit) break;
    }
    return array('ok' => true, 'items' => $items);
  }

  public static function stock(WP_REST_Request $req) {
    $holders = $req->get_param('holders');
    if (!is_array($holders)) $holders = array();
    $items = array();
    global $wpdb;
    foreach ($holders as $h) {
      $found = self::product_from_holder(is_array($h) ? $h : array('holder_key' => $h));
      if (!$found) continue;
      list($product, $pid, $vid, $key) = $found;
      $last_seq = (int)$wpdb->get_var($wpdb->prepare('SELECT MAX(seq) FROM ' . self::table() . ' WHERE holder_key = %s', $key));
      $items[] = array_merge(self::item($product), array('last_seq' => $last_seq));
    }
    return array('ok' => true, 'items' => $items);
  }

  public static function apply(WP_REST_Request $req) {
    $body = $req->get_json_params();
    if (!is_array($body)) $body = array();
    $found = self::product_from_holder($body);
    if (!$found) return new WP_Error('mahak_not_found', 'Product/variation not found.', array('status' => 404));
    list($product, $pid, $vid, $key) = $found;
    if (!$product->managing_stock()) return new WP_Error('mahak_manage_stock_off', 'manage_stock is disabled for this holder.', array('status' => 409));
    $expected = isset($body['expected']) ? intval($body['expected']) : null;
    $target = intval($body['target']);
    $current = (int)$product->get_stock_quantity();
    if ($expected !== null && $current !== $expected) {
      return new WP_REST_Response(array('ok' => false, 'conflict' => true, 'current' => $current, 'expected' => $expected, 'message' => 'Stock changed on WooCommerce before MAHAK apply.'), 409);
    }
    $request_id = sanitize_text_field((string)($body['request_id'] ?? wp_generate_uuid4()));
    if ($current === $target) return array('ok' => true, 'old_qty' => $current, 'new_qty' => $target, 'holder_key' => $key, 'noop' => true);
    self::$suppress = true;
    self::$request_id = $request_id;
    wc_update_product_stock($product, $target, 'set', true);
    self::$suppress = false;
    self::record($pid, $vid, $current, $target, 'mahak_apply', null, null, $request_id, array('target' => $target));
    self::$request_id = null;
    return array('ok' => true, 'old_qty' => $current, 'new_qty' => $target, 'holder_key' => $key);
  }

  public static function journal(WP_REST_Request $req) {
    global $wpdb;
    $after = max(0, absint($req->get_param('after_seq')));
    $limit = max(1, min(200, absint($req->get_param('limit') ?: 100)));
    $rows = $wpdb->get_results($wpdb->prepare('SELECT * FROM ' . self::table() . ' WHERE seq > %d ORDER BY seq ASC LIMIT %d', $after, $limit), ARRAY_A);
    $events = array();
    foreach ($rows as $r) {
      $events[] = array(
        'seq' => (int)$r['seq'], 'event_uuid' => $r['event_uuid'], 'holder_key' => $r['holder_key'],
        'product_id' => (int)$r['product_id'], 'variation_id' => $r['variation_id'] === null ? null : (int)$r['variation_id'],
        'old_qty' => $r['old_qty'] === null ? null : (int)$r['old_qty'], 'new_qty' => (int)$r['new_qty'], 'delta' => (int)$r['delta_qty'],
        'source' => $r['source'], 'order_id' => $r['order_id'], 'order_item_id' => $r['order_item_id'], 'request_id' => $r['request_id'],
        'created_at' => $r['created_at']
      );
    }
    return array('ok' => true, 'events' => $events);
  }

  public static function before_stock($product) {
    if (!$product || self::$suppress) return;
    self::$before[$product->get_id()] = (int)$product->get_stock_quantity();
  }

  public static function after_stock($product) {
    if (!$product || self::$suppress) return;
    $id = $product->get_id();
    $old = array_key_exists($id, self::$before) ? self::$before[$id] : null;
    $new = (int)$product->get_stock_quantity();
    if ($old === null) {
      $meta = get_post_meta($id, '_mahak_stock_last_qty', true);
      $old = ($meta === '') ? $new : intval($meta);
    }
    update_post_meta($id, '_mahak_stock_last_qty', $new);
    if ($old === $new) return;
    $pid = $product->is_type('variation') ? $product->get_parent_id() : $product->get_id();
    $vid = $product->is_type('variation') ? $product->get_id() : null;
    $source = self::$order_id ? 'order' : 'woocommerce';
    self::record($pid, $vid, $old, $new, $source, self::$order_id, null, self::$request_id, null);
  }

  private static function record($product_id, $variation_id, $old, $new, $source, $order_id = null, $order_item_id = null, $request_id = null, $payload = null) {
    $old = ($old === null) ? null : intval($old);
    $new = intval($new);
    if ($old !== null && $old === $new) return;
    global $wpdb;
    $event_uuid = wp_generate_uuid4();
    $wpdb->insert(self::table(), array(
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
      'request_id' => $request_id === null ? null : (string)$request_id,
      'created_at' => current_time('mysql', true),
      'payload_json' => $payload === null ? null : wp_json_encode($payload),
    ), array('%s','%s','%d','%d','%d','%d','%d','%s','%s','%s','%s','%s','%s'));
  }

  public static function admin_menu() {
    add_submenu_page('woocommerce', 'MAHAK Stock Sync', 'محک موجودی', 'manage_woocommerce', 'mahak-stock-sync', array(__CLASS__, 'settings_page'));
  }

  public static function settings_page() {
    if (!current_user_can('manage_woocommerce')) return;
    $new = isset($_GET['mahak_new_token']) ? sanitize_text_field(wp_unslash($_GET['mahak_new_token'])) : '';
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
      wp_safe_redirect(add_query_arg(array('page' => 'mahak-stock-sync', 'mahak_new_token' => rawurlencode($token)), admin_url('admin.php')));
      exit;
    }
    wp_safe_redirect(add_query_arg(array('page' => 'mahak-stock-sync'), admin_url('admin.php')));
    exit;
  }
}

register_activation_hook(__FILE__, array('Mahak_Stock_Sync_Plugin', 'activate'));
add_action('plugins_loaded', array('Mahak_Stock_Sync_Plugin', 'init'));
