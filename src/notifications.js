import emailjs from '@emailjs/browser';

const SERVICE_ID = process.env.REACT_APP_EMAILJS_SERVICE_ID;
const TEMPLATE_ID = process.env.REACT_APP_EMAILJS_TEMPLATE_ID;
const PUBLIC_KEY = process.env.REACT_APP_EMAILJS_PUBLIC_KEY;

// Sends a notification email. Fails silently (logs only) so that a
// missing/broken email setup never blocks the actual app action —
// notifications are a nice-to-have, not something that should stop
// someone from applying for a loan or HR from approving one.
async function sendNotification(toEmail, toName, subject, message) {
  if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY) {
    console.warn('EmailJS not configured — skipping notification:', subject);
    return;
  }

  try {
    await emailjs.send(
      SERVICE_ID,
      TEMPLATE_ID,
      {
        to_email: toEmail,
        to_name: toName,
        subject,
        message,
      },
      PUBLIC_KEY
    );
  } catch (err) {
    console.error('Failed to send notification email:', err);
  }
}

// ------------------------------------------------
// One function per lifecycle event, so calling code
// stays readable (e.g. notifyGuarantorRequested(...))
// ------------------------------------------------

export function notifyGuarantorRequested(guarantor, applicant, loan) {
  sendNotification(
    guarantor.email,
    guarantor.full_name,
    'You have been asked to be a loan guarantor',
    `Hello ${guarantor.full_name},\n\n${applicant.full_name} has applied for a ${loan.type === 'iou' ? 'IOU' : 'loan'} of ₦${Number(loan.amount).toLocaleString()} and has named you as their guarantor.\n\nReason given: ${loan.reason}\n\nPlease log in to the Sunnybell Loan Portal to accept or decline this request.\n\n— Sunnybell Height Concept Ltd`
  );
}

export function notifyGuarantorResponse(applicant, guarantor, loan, accepted) {
  sendNotification(
    applicant.email,
    applicant.full_name,
    accepted ? 'Your guarantor has accepted' : 'Your guarantor has declined',
    accepted
      ? `Hello ${applicant.full_name},\n\n${guarantor.full_name} has accepted to guarantee your ${loan.type === 'iou' ? 'IOU' : 'loan'} request of ₦${Number(loan.amount).toLocaleString()}. Your request is now with HR for review.\n\n— Sunnybell Height Concept Ltd`
      : `Hello ${applicant.full_name},\n\n${guarantor.full_name} has declined to guarantee your ${loan.type === 'iou' ? 'IOU' : 'loan'} request. Please log in to resubmit with a different guarantor.\n\n— Sunnybell Height Concept Ltd`
  );
}

export function notifyHRDecision(applicant, loan, approved) {
  sendNotification(
    applicant.email,
    applicant.full_name,
    approved ? 'Your loan request has been approved' : 'Your loan request has been declined',
    approved
      ? `Hello ${applicant.full_name},\n\nHR has approved your ${loan.type === 'iou' ? 'IOU' : 'loan'} request${loan.approved_amount && loan.approved_amount !== loan.amount ? ` for an adjusted amount of ₦${Number(loan.approved_amount).toLocaleString()}` : ''}. It now moves to the contractor for payment.\n\n— Sunnybell Height Concept Ltd`
      : `Hello ${applicant.full_name},\n\nHR has declined your ${loan.type === 'iou' ? 'IOU' : 'loan'} request. Please speak with HR if you have questions.\n\n— Sunnybell Height Concept Ltd`
  );
}

export function notifyDisbursement(applicant, loan) {
  sendNotification(
    applicant.email,
    applicant.full_name,
    'Your loan payment has been disbursed',
    `Hello ${applicant.full_name},\n\nYour ${loan.type === 'iou' ? 'IOU' : 'loan'} of ₦${Number(loan.approved_amount ?? loan.amount).toLocaleString()} has been paid out. Repayment deductions will begin from your next applicable salary date.\n\n— Sunnybell Height Concept Ltd`
  );
}

export function notifyLoanCompleted(applicant, loan) {
  sendNotification(
    applicant.email,
    applicant.full_name,
    'Your loan has been fully repaid',
    `Hello ${applicant.full_name},\n\nCongratulations — your ${loan.type === 'iou' ? 'IOU' : 'loan'} of ₦${Number(loan.approved_amount ?? loan.amount).toLocaleString()} has been fully repaid. Thank you.\n\n— Sunnybell Height Concept Ltd`
  );
}
