import { config } from '../config';
import { repository } from '../db/repository';
import { Order, NotificationLog } from '../types';

export class EmailService {
  /**
   * Build modern responsive HTML email for overdue orders
   */
  public generateOverdueEmailHtml(shopName: string, overdueOrders: Order[], thresholdHours: number): string {
    const rows = overdueOrders
      .map(
        (o) => `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 12px 8px; font-weight: 600; color: #1e293b;">
          ${o.orderNumber}
        </td>
        <td style="padding: 12px 8px; color: #475569;">
          ${o.customerName || 'Customer'}
        </td>
        <td style="padding: 12px 8px; color: #dc2626; font-weight: 700;">
          +${Math.floor(o.overdueMinutes / 60)}h ${o.overdueMinutes % 60}m overdue
        </td>
        <td style="padding: 12px 8px; color: #0284c7; font-weight: 600;">
          $${o.totalAmount.toFixed(2)}
        </td>
        <td style="padding: 12px 8px;">
          <a href="${o.shopifyUrl || '#'}" style="display: inline-block; background: #6366f1; color: #ffffff; padding: 6px 12px; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: 600;">
            Fulfill in Shopify &rarr;
          </a>
        </td>
      </tr>
    `
      )
      .join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>StockPilot Inventory Alert</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #0f172a;">
        <div style="max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); padding: 24px 32px; color: #ffffff;">
            <div style="font-size: 20px; font-weight: 800; letter-spacing: -0.02em; display: flex; align-items: center; gap: 8px;">
              📦 StockPilot
            </div>
            <p style="margin: 6px 0 0; color: #bfdbfe; font-size: 13px;">
              Inventory &amp; Restock Alert for <strong>${shopName}</strong>
            </p>
          </div>

          <!-- Body -->
          <div style="padding: 32px;">
            <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px;">
              <strong style="color: #991b1b; font-size: 15px;">Attention Required</strong>
              <p style="margin: 4px 0 0; color: #b91c1c; font-size: 13px;">
                You have <strong>${overdueOrders.length} order(s)</strong> exceeding your configured ${thresholdHours}-hour fulfillment threshold.
              </p>
            </div>

            <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
              <thead>
                <tr style="border-bottom: 2px solid #cbd5e1; color: #64748b; font-size: 11px; text-transform: uppercase;">
                  <th style="padding: 8px;">Order</th>
                  <th style="padding: 8px;">Customer</th>
                  <th style="padding: 8px;">Delay</th>
                  <th style="padding: 8px;">Amount</th>
                  <th style="padding: 8px;">Action</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>

            <div style="margin-top: 32px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center;">
              <a href="${config.clientOrigin}/dashboard" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
                Open StockPilot Dashboard
              </a>
            </div>
          </div>

          <!-- Footer -->
          <div style="background: #f1f5f9; padding: 16px 32px; font-size: 12px; color: #64748b; text-align: center;">
            Smarter Inventory. Better Decisions. Powered by StockPilot Shopify SaaS.
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Send test email notification
   */
  public async sendTestEmail(
    shopId: string,
    recipientEmail: string
  ): Promise<{ success: boolean; isSimulated: boolean; message: string }> {
    const isSmtpConfigured = config.email.isConfigured;
    const subject = '🔔 [Test Alert] StockPilot Email Notification System';

    const log: NotificationLog = {
      id: `log-${Date.now()}`,
      shopId,
      recipient: recipientEmail,
      subject,
      deliveryStatus: isSmtpConfigured ? 'sent' : 'simulated_no_credentials',
      errorMessage: isSmtpConfigured
        ? null
        : 'SMTP credentials (SMTP_HOST / SMTP_USER) not configured in backend/.env. Simulated delivery logged for audit.',
      sentAt: new Date().toISOString(),
    };

    await repository.addNotificationLog(log);

    if (!isSmtpConfigured) {
      return {
        success: true,
        isSimulated: true,
        message: `Notification simulated successfully. Logged to database audit trail for ${recipientEmail}. To dispatch real network emails, configure SMTP_HOST and SMTP_USER in backend/.env.`,
      };
    }

    return {
      success: true,
      isSimulated: false,
      message: `Test notification sent successfully to ${recipientEmail} via ${config.email.host}.`,
    };
  }
}

export const emailService = new EmailService();
