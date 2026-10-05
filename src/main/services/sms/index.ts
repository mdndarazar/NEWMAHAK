/**
 * نقطه‌ی ورود ماژول «پنل پیامکی».
 *
 * بیرون از این پوشه، هیچ‌کس نباید مستقیماً به `SmsQueue` یا `SmsTemplates`
 * دست بزند؛ فقط `smsService`. همین یک قاعده، ماژول را قابل‌جدا‌کردن نگه
 * می‌دارد: حذف کل پوشه، هیچ جای دیگری از برنامه را نمی‌شکند.
 */
export { smsService, SMS_STATUS_OPTIONS, SMS_EVENT_OPTIONS } from './SmsService'
export { enqueueSms } from './SmsQueue'
export { smsQueueService, startSmsQueue, stopSmsQueue, runSmsQueueOnce, recoverStale } from './SmsQueue'
export { setSmsOutcomeHook } from './SmsQueue'
export type { SmsOutcomeEvent } from './SmsQueue'
export { smsTemplateService } from './SmsTemplates'
export { smsCredentialService } from './SmsCredentials'
export { smsCampaignService, smsOptOutService, currentOptOutNote, isSmsOptedOut } from './SmsCampaignService'
export { smsNotificationSender } from './SmsNotificationSender'
export { setSmsReminderSource, runSmsAutoOnce, startSmsAuto, stopSmsAuto, smsReminderSourceName } from './SmsService'
export type { SmsReminderSource } from './SmsService'
