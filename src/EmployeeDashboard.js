import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import Sidebar from './Sidebar';
import { notifyGuarantorRequested, notifyGuarantorResponse } from './notifications';

function EmployeeDashboard({ profile, onLogout }) {
  const [tab, setTab] = useState('apply');
  const [loans, setLoans] = useState([]);
  const [repayments, setRepayments] = useState([]);
  const [guarantorRequests, setGuarantorRequests] = useState([]);
  const [names, setNames] = useState({}); // cache of id -> name lookups
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [type, setType] = useState('loan');
  const [amount, setAmount] = useState('');
  const [months, setMonths] = useState(1);
  const [reason, setReason] = useState('');
  const [guarantorStaffId, setGuarantorStaffId] = useState('');
  const [resubmitLoanId, setResubmitLoanId] = useState(null);
  const [resubmitStaffId, setResubmitStaffId] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);

  // Formats a raw number string with commas for display, e.g. "150000" -> "150,000"
  const formatNumberInput = (value) => {
    const digitsOnly = value.replace(/[^0-9]/g, '');
    return digitsOnly ? Number(digitsOnly).toLocaleString() : '';
  };

  useEffect(() => {
    fetchLoans();
    fetchGuarantorRequests();
  }, []);

  const lookupName = async (id) => {
    if (!id || names[id]) return;
    const { data } = await supabase.rpc('get_employee_name', { emp_id: id });
    if (data) setNames((prev) => ({ ...prev, [id]: data }));
  };

  const fetchLoans = async () => {
    const { data: loanData } = await supabase
      .from('loans')
      .select('*')
      .eq('employee_id', profile.id)
      .order('applied_date', { ascending: false });

    setLoans(loanData || []);
    (loanData || []).forEach((l) => l.guarantor_id && lookupName(l.guarantor_id));

    if (loanData && loanData.length > 0) {
      const loanIds = loanData.map((l) => l.id);
      const { data: repaymentData } = await supabase
        .from('repayments')
        .select('*')
        .in('loan_id', loanIds)
        .order('due_date', { ascending: true });
      setRepayments(repaymentData || []);
    }
  };

  const fetchGuarantorRequests = async () => {
    const { data } = await supabase
      .from('guarantor_requests')
      .select('*, loans(*)')
      .eq('guarantor_id', profile.id)
      .eq('status', 'pending');
    setGuarantorRequests(data || []);
    (data || []).forEach((r) => r.loans?.employee_id && lookupName(r.loans.employee_id));
  };

  const handleApply = async (e) => {
    e.preventDefault();
    setMessage('');

    if (submitting) return; // guard against double-click
    setSubmitting(true);

    const requiresGuarantor = type === 'loan';

    if (requiresGuarantor && !guarantorStaffId.trim()) {
      setMessage('A guarantor Staff ID is required for loans.');
      setSubmitting(false);
      return;
    }

    if (!agreeTerms) {
      setMessage('You must agree to the repayment terms before submitting.');
      setSubmitting(false);
      return;
    }

    let guarantor = null;

    if (requiresGuarantor) {
      const { data: guarantorData, error: guarantorError } = await supabase
        .rpc('find_employee_by_staff_id', { staff_id_input: guarantorStaffId.trim() });

      if (guarantorError || !guarantorData || guarantorData.length === 0) {
        setMessage('No employee found with that Staff ID. Please check and try again.');
        setSubmitting(false);
        return;
      }

      guarantor = guarantorData[0];

      if (guarantor.id === profile.id) {
        setMessage('You cannot be your own guarantor.');
        setSubmitting(false);
        return;
      }
    }

    const numAmount = parseFloat(amount);
    const numMonths = type === 'iou' ? 1 : parseInt(months);
    const monthlyDeduction = type === 'iou' ? numAmount : numAmount / numMonths;

    const { data: newLoan, error: loanError } = await supabase
      .from('loans')
      .insert({
        employee_id: profile.id,
        type,
        amount: numAmount,
        months: numMonths,
        monthly_deduction: monthlyDeduction,
        reason,
        guarantor_id: guarantor ? guarantor.id : null,
        // IOUs skip the guarantor step and go straight to HR
        status: requiresGuarantor ? 'awaiting_guarantor' : 'pending',
        applied_date: new Date().toISOString(),
      })
      .select()
      .single();

    if (loanError) {
      setMessage('Error submitting request: ' + loanError.message);
      setSubmitting(false);
      return;
    }

    if (requiresGuarantor) {
      await supabase.from('guarantor_requests').insert({
        loan_id: newLoan.id,
        guarantor_id: guarantor.id,
        status: 'pending',
      });
      notifyGuarantorRequested(guarantor, profile, newLoan);
      setMessage(`Request submitted. Waiting for ${guarantor.full_name} to confirm as your guarantor.`);
    } else {
      setMessage('IOU request submitted. Waiting for HR review.');
    }

    setAmount('');
    setMonths(1);
    setReason('');
    setGuarantorStaffId('');
    setAgreeTerms(false);
    setSubmitting(false);
    fetchLoans();
  };

  const handleResubmit = async (loanId) => {
    if (!resubmitStaffId.trim()) {
      setMessage('Please enter a new guarantor Staff ID.');
      return;
    }

    const { data: guarantorData, error: guarantorError } = await supabase
      .rpc('find_employee_by_staff_id', { staff_id_input: resubmitStaffId.trim() });

    if (guarantorError || !guarantorData || guarantorData.length === 0) {
      setMessage('No employee found with that Staff ID. Please check and try again.');
      return;
    }

    const guarantor = guarantorData[0];

    if (guarantor.id === profile.id) {
      setMessage('You cannot be your own guarantor.');
      return;
    }

    const { error: updateError } = await supabase
      .from('loans')
      .update({ guarantor_id: guarantor.id, status: 'awaiting_guarantor' })
      .eq('id', loanId);

    if (updateError) {
      setMessage('Error resubmitting: ' + updateError.message);
      return;
    }

    await supabase.from('guarantor_requests').insert({
      loan_id: loanId,
      guarantor_id: guarantor.id,
      status: 'pending',
    });

    const resubmittedLoan = loans.find((l) => l.id === loanId);
    notifyGuarantorRequested(guarantor, profile, resubmittedLoan || { id: loanId, type: 'loan', amount: 0, reason: '' });
    setMessage(`Resubmitted. Waiting for ${guarantor.full_name} to confirm as your guarantor.`);
    setResubmitLoanId(null);
    setResubmitStaffId('');
    fetchLoans();
  };

  const handleGuarantorResponse = async (requestId, loanId, response) => {
    await supabase
      .from('guarantor_requests')
      .update({ status: response, responded_date: new Date().toISOString() })
      .eq('id', requestId);

    await supabase
      .from('loans')
      .update({ status: response === 'accepted' ? 'pending' : 'guarantor_declined' })
      .eq('id', loanId);

    // Notify the applicant of the guarantor's decision
    const { data: loanData } = await supabase.from('loans').select('*').eq('id', loanId).single();
    if (loanData) {
      const { data: applicantData } = await supabase.from('employees').select('*').eq('id', loanData.employee_id).single();
      if (applicantData) {
        notifyGuarantorResponse(applicantData, profile, loanData, response === 'accepted');
      }
    }

    fetchGuarantorRequests();
  };

  const getRepaymentsFor = (loanId) => repayments.filter((r) => r.loan_id === loanId);

  const statusLabel = (status) => {
    const labels = {
      awaiting_guarantor: 'Waiting for guarantor',
      guarantor_declined: 'Guarantor declined — resubmit with a new guarantor',
      pending: 'Waiting for HR review',
      approved: 'Approved — waiting for payment',
      declined: 'Declined by HR',
      disbursed: 'Disbursed — repaying',
      completed: 'Completed',
    };
    return labels[status] || status;
  };

  const groupedStatement = () => {
    const groups = {};
    repayments.forEach((r) => {
      const date = new Date(r.due_date);
      const year = date.getFullYear();
      const month = date.toLocaleString('default', { month: 'long' });
      if (!groups[year]) groups[year] = {};
      if (!groups[year][month]) groups[year][month] = [];
      groups[year][month].push(r);
    });
    return groups;
  };

  const tabList = [
    { id: 'apply', label: 'Apply for Loan / IOU', badge: 0 },
    { id: 'history', label: 'Loan / IOU History', badge: 0 },
    { id: 'profile', label: 'My Profile', badge: 0 },
    { id: 'statement', label: 'Account Statement', badge: 0 },
    { id: 'guarantor', label: 'Guarantor Requests', badge: guarantorRequests.length },
  ];

  const tabTitles = {
    apply: 'Apply for Loan / IOU',
    history: 'Loan / IOU History',
    profile: 'My Profile',
    statement: 'Account Statement',
    guarantor: 'Guarantor Requests',
  };

  return (
    <div className="app-shell">
      <Sidebar
        tabs={tabList}
        activeTab={tab}
        onTabChange={setTab}
        roleLabel="Employee"
        fullName={profile.full_name}
        onLogout={onLogout}
      />
      <div className="dashboard-container">
        <div className="dashboard-header">
          <h1>{tabTitles[tab]}</h1>
        </div>

      {tab === 'apply' && (
        <>
          <form onSubmit={handleApply} className="apply-form">
            {message && <div className="form-message">{message}</div>}

            <label>Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="loan">Loan (up to 3 months)</option>
              <option value="iou">IOU (repaid same month)</option>
            </select>

            <label>Amount (₦)</label>
            <input
              type="text"
              inputMode="numeric"
              value={formatNumberInput(amount)}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="e.g. 150,000"
              required
            />

            {type === 'loan' && (
              <>
                <label>Repayment Period (months)</label>
                <select value={months} onChange={(e) => setMonths(e.target.value)}>
                  <option value={1}>1 month</option>
                  <option value={2}>2 months</option>
                  <option value={3}>3 months</option>
                </select>
              </>
            )}

            <label>Reason for Loan/IOU</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} required rows="3" />

            {type === 'loan' && (
              <>
                <label>Guarantor's Staff ID</label>
                <input
                  type="text"
                  value={guarantorStaffId}
                  onChange={(e) => setGuarantorStaffId(e.target.value)}
                  placeholder="e.g. EMP045"
                  required
                />
              </>
            )}

            <div className="policy-text">
              <p><strong>Repayment Agreement:</strong> By submitting this request, you confirm that the amount and repayment terms shown are accurate, and you authorize the agreed monthly deduction from your salary until the balance is fully repaid. If you leave the company before full repayment, any outstanding balance remains payable and may be deducted from final settlement.</p>
            </div>

            <div className="form-group checkbox">
              <input
                type="checkbox"
                id="agreeTerms"
                checked={agreeTerms}
                onChange={(e) => setAgreeTerms(e.target.checked)}
                required
              />
              <label htmlFor="agreeTerms">I have read and agree to the repayment terms *</label>
            </div>

            <button type="submit" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </form>
        </>
      )}

      {tab === 'history' && (
        <>
          <h2>Your Loan / IOU History</h2>
          {loans.length === 0 && <p>No requests yet.</p>}
          {loans.map((loan) => (
            <div key={loan.id} className="loan-summary-card">
              <div className="loan-summary-top">
                <div className="loan-summary-amount">
                  <span className="loan-type-tag">{loan.type === 'iou' ? 'IOU' : 'LOAN'}</span>
                  <span className="loan-summary-figure">₦{Number(loan.amount).toLocaleString()}</span>
                </div>
                <span className={`status-badge status-${loan.status}`}>{statusLabel(loan.status)}</span>
              </div>

              <div className="loan-summary-grid">
                {loan.approved_amount && Number(loan.approved_amount) !== Number(loan.amount) && (
                  <div className="loan-summary-field full-width">
                    <span className="loan-summary-label">HR Approved Amount</span>
                    <span className="loan-summary-value">₦{Number(loan.approved_amount).toLocaleString()} (adjusted from your request)</span>
                  </div>
                )}
                <div className="loan-summary-field full-width">
                  <span className="loan-summary-label">Reason</span>
                  <span className="loan-summary-value">{loan.reason}</span>
                </div>
                {loan.guarantor_id && (
                  <div className="loan-summary-field">
                    <span className="loan-summary-label">Guarantor</span>
                    <span className="loan-summary-value">{names[loan.guarantor_id] || 'Loading...'}</span>
                  </div>
                )}
                <div className="loan-summary-field">
                  <span className="loan-summary-label">Applied</span>
                  <span className="loan-summary-value">{loan.applied_date ? new Date(loan.applied_date).toLocaleDateString('en-GB') : '—'}</span>
                </div>
              </div>

              {loan.status === 'guarantor_declined' && (
                resubmitLoanId === loan.id ? (
                  <div className="resubmit-box">
                    <label>New Guarantor's Staff ID</label>
                    <input
                      type="text"
                      value={resubmitStaffId}
                      onChange={(e) => setResubmitStaffId(e.target.value)}
                      placeholder="e.g. EMP045"
                    />
                    <div className="action-buttons">
                      <button className="approve-btn" onClick={() => handleResubmit(loan.id)}>Send Request</button>
                      <button className="decline-btn" onClick={() => setResubmitLoanId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button className="apply-btn small-btn" onClick={() => setResubmitLoanId(loan.id)}>
                    Resubmit with New Guarantor
                  </button>
                )
              )}
            </div>
          ))}
        </>
      )}

      {tab === 'profile' && (
        <div className="profile-card">
          <h2>Membership Profile</h2>
          <div className="profile-grid">
            <div><strong>Full Name:</strong> {profile.full_name}</div>
            <div><strong>Staff ID:</strong> {profile.staff_id}</div>
            <div><strong>Department:</strong> {profile.department}</div>
            <div><strong>Email:</strong> {profile.email}</div>
          </div>

          <div className="profile-grid">
            <div><strong>Gender:</strong> {profile.gender || '—'}</div>
            <div><strong>Date of Birth:</strong> {profile.date_of_birth || '—'}</div>
            <div><strong>Marital Status:</strong> {profile.marital_status || '—'}</div>
            <div><strong>Telephone:</strong> {profile.telephone_number || '—'}</div>
            <div className="full-width"><strong>Address:</strong> {profile.address || '—'}</div>
          </div>

          <h2>Bank Information</h2>
          <div className="profile-grid">
            <div><strong>Bank Name:</strong> {profile.bank_name || '—'}</div>
            <div><strong>Account No:</strong> {profile.account_number || '—'}</div>
            <div><strong>Account Name:</strong> {profile.account_name || '—'}</div>
          </div>

          <p className="profile-note">To update any of this information, please contact HR.</p>
        </div>
      )}

      {tab === 'statement' && (
        <div>
          <h2>Account Statement</h2>
          {Object.keys(groupedStatement()).length === 0 && <p>No repayment history yet.</p>}
          {Object.entries(groupedStatement()).sort((a, b) => b[0] - a[0]).map(([year, months]) => {
            const allYearItems = Object.values(months).flat().sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
            const yearTotal = allYearItems.reduce((sum, r) => sum + Number(r.amount || 0), 0);
            const yearPaid = allYearItems.reduce((sum, r) => sum + Number(r.amount_collected || 0), 0);

            return (
              <div key={year} className="statement-year">
                <h3>{year}</h3>

                <div className="balance-grid" style={{ marginBottom: '14px' }}>
                  <div><span className="balance-label">Total This Year</span><span className="balance-value">₦{yearTotal.toLocaleString()}</span></div>
                  <div><span className="balance-label">Paid</span><span className="balance-value paid">₦{yearPaid.toLocaleString()}</span></div>
                  <div><span className="balance-label">Outstanding</span><span className="balance-value remaining">₦{(yearTotal - yearPaid).toLocaleString()}</span></div>
                </div>

                <div className="table-wrapper">
                  <table className="history-table">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Due Date</th>
                        <th>Amount</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allYearItems.map((r) => (
                        <tr key={r.id}>
                          <td>{new Date(r.due_date).toLocaleString('default', { month: 'long' })}</td>
                          <td>{new Date(r.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                          <td>₦{Number(r.amount).toLocaleString()}</td>
                          <td>
                            {r.paid ? (
                              <span className="status-badge status-completed">Paid</span>
                            ) : (
                              <span className="status-badge status-pending">Pending</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'guarantor' && (
        <div>
          <h2>Guarantor Requests</h2>
          {guarantorRequests.length === 0 && <p>No pending guarantor requests.</p>}
          {guarantorRequests.map((req) => (
            <div key={req.id} className="loan-card">
              <p>
                <strong>{names[req.loans.employee_id] || 'Someone'}</strong> is asking you to guarantee a{' '}
                <strong>{req.loans.type === 'iou' ? 'IOU' : 'Loan'}</strong> of ₦{req.loans.amount.toLocaleString()}
              </p>
              <p>Reason: {req.loans.reason}</p>
              <p>Do you accept to stand as guarantor for this amount?</p>
              <div className="action-buttons">
                <button className="approve-btn" onClick={() => handleGuarantorResponse(req.id, req.loan_id, 'accepted')}>Accept</button>
                <button className="decline-btn" onClick={() => handleGuarantorResponse(req.id, req.loan_id, 'declined')}>Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

export default EmployeeDashboard;
