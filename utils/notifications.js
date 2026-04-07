const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function sendEmailNotification({ to, subject, html }) {
  if (!resend) {
    console.log('Email notifications disabled - no RESEND_API_KEY set');
    return null;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: 'ContentFlow <notifications@neulumastudios.com>',
      to,
      subject,
      html,
    });

    if (error) {
      console.error('Email notification error:', error);
      return null;
    }

    console.log('Email notification sent:', data?.id);
    return data;
  } catch (err) {
    console.error('Failed to send email notification:', err.message);
    return null;
  }
}

function notifyStatusChange({ post, newStatus, changedBy, db }) {
  const creator = db.prepare('SELECT * FROM users WHERE id = ?').get(post.created_by);
  if (!creator || !creator.email || creator.id === changedBy.id) return;

  const statusLabels = {
    approved: 'Approved',
    rejected: 'Rejected',
    needs_revision: 'Needs Revision',
  };

  const statusLabel = statusLabels[newStatus] || newStatus;
  const appUrl = process.env.APP_URL || 'https://contentflow-dashboard-production.up.railway.app';

  sendEmailNotification({
    to: creator.email,
    subject: `Post ${statusLabel}: "${post.title}"`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #6366f1; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0;">ContentFlow Notification</h2>
        </div>
        <div style="padding: 20px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">
          <p>Hi ${creator.name},</p>
          <p>Your post <strong>"${post.title}"</strong> has been marked as <strong>${statusLabel}</strong> by ${changedBy.name}.</p>
          <p style="margin-top: 20px;">
            <a href="${appUrl}"
               style="background: #6366f1; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">
              View in ContentFlow
            </a>
          </p>
        </div>
      </div>
    `,
  });
}

function notifyNewComment({ post, comment, commenter, db }) {
  const creator = db.prepare('SELECT * FROM users WHERE id = ?').get(post.created_by);
  if (!creator || !creator.email || creator.id === commenter.id) return;

  const appUrl = process.env.APP_URL || 'https://contentflow-dashboard-production.up.railway.app';

  sendEmailNotification({
    to: creator.email,
    subject: `New Comment on "${post.title}"`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #6366f1; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0;">ContentFlow Notification</h2>
        </div>
        <div style="padding: 20px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">
          <p>Hi ${creator.name},</p>
          <p><strong>${commenter.name}</strong> commented on your post <strong>"${post.title}"</strong>:</p>
          <blockquote style="border-left: 3px solid #6366f1; padding: 10px 15px; margin: 15px 0; background: white; border-radius: 4px;">
            ${comment.content}
          </blockquote>
          <p style="margin-top: 20px;">
            <a href="${appUrl}"
               style="background: #6366f1; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">
              View in ContentFlow
            </a>
          </p>
        </div>
      </div>
    `,
  });
}

module.exports = { sendEmailNotification, notifyStatusChange, notifyNewComment };
