const nodemailer = require('nodemailer');

let transporterPromise;

function getClientOrigin() {
  return process.env.CLIENT_ORIGIN || 'http://localhost:3000';
}

function hasEmailConfig() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_FROM);
}

async function getTransporter() {
  if (!transporterPromise) {
    transporterPromise = Promise.resolve(
      nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
        auth:
          process.env.SMTP_USER || process.env.SMTP_PASS
            ? {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
              }
            : undefined,
      })
    );
  }

  return transporterPromise;
}

async function sendEmail({ to, subject, text }) {
  if (!hasEmailConfig() || !to) return false;

  const transporter = await getTransporter();
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text,
  });
  return true;
}

function formatTaskDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function formatRoleLabel(role) {
  return String(role || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

async function sendApprovalEmail(user) {
  return sendEmail({
    to: user.email,
    subject: 'Your Task Tracker account is approved',
    text: [
      `Hi ${user.name},`,
      '',
      'Your Task Tracker account has been approved.',
      `Role: ${formatRoleLabel(user.role)}`,
      user.jobTitle ? `Job title: ${user.jobTitle}` : '',
      '',
      `You can now sign in here: ${getClientOrigin()}/login`,
    ]
      .filter(Boolean)
      .join('\n'),
  });
}

async function sendTaskAssignedEmail(user, task) {
  return sendEmail({
    to: user.email,
    subject: `New task assigned for ${formatTaskDate(task.date)}`,
    text: [
      `Hi ${user.name},`,
      '',
      `A task was assigned to you for ${formatTaskDate(task.date)}.`,
      `Task: ${task.assignedTask}`,
      task.brief ? `Brief: ${task.brief}` : '',
      '',
      `Open your task board: ${getClientOrigin()}/employee/today`,
    ]
      .filter(Boolean)
      .join('\n'),
  });
}

async function sendTaskReviewEmail(user, task) {
  return sendEmail({
    to: user.email,
    subject: `Task review updated for ${formatTaskDate(task.date)}`,
    text: [
      `Hi ${user.name},`,
      '',
      `Your task review was updated for ${formatTaskDate(task.date)}.`,
      `Task: ${task.assignedTask}`,
      `Verified status: ${task.adminStatus}`,
      task.reviewerNotes ? `Reviewer notes: ${task.reviewerNotes}` : '',
      '',
      `Review it here: ${getClientOrigin()}/employee/log`,
    ]
      .filter(Boolean)
      .join('\n'),
  });
}

async function sendPasswordResetEmail(user, token) {
  return sendEmail({
    to: user.email,
    subject: 'Reset your Task Tracker password',
    text: [
      `Hi ${user.name},`,
      '',
      'Someone requested a password reset for your account. If this was you, click the link below',
      '(valid for 1 hour) to choose a new password:',
      '',
      `${getClientOrigin()}/reset-password?token=${token}`,
      '',
      "If you didn't request this, you can safely ignore this email — your password won't change.",
    ].join('\n'),
  });
}

module.exports = {
  hasEmailConfig,
  sendApprovalEmail,
  sendTaskAssignedEmail,
  sendTaskReviewEmail,
  sendPasswordResetEmail,
};
