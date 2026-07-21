import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import Sidebar from './Sidebar';
import { notifyHRDecision } from './notifications';

function HRDashboard({ profile, onLogout }) {
  const [tab, setTab] = useState('pending');
  const [loans, setLoans] = useState([]);
  const [repayments, setRepayments] = useState([]);
  const [employees, setEmployees] = useState({});
  const [approvedAmounts, setApprovedAmounts] = useState({});
  const [approvedMonths, setApprovedMonths] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [editingEmployeeId, setEditingEmployeeId] = useState(null);
  const [profileForm, setProfileForm] = useState({});
  const [profileSearchTerm, setProfileSearchTerm] = useState('');
  const [auditLog, setAuditLog] = useState([]);
  const [exportMonth, setExportMonth] = useState('all');
  const [exportYear, setExportYear] = useState('all');

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    const { data: loanData } = await supabase
      .from('loans')
      .select('*')
      .order('applied_date', { ascending: false });

    setLoans(loanData || []);

    if (loanData && loanData.length > 0) {
      const loanIds = loanData.map((l) => l.id);
      const { data: repaymentData } = await supabase
        .from('repayments')
        .select('*')
        .in('loan_id', loanIds)
        .order('due_date', { ascending: true });
      setRepayments(repaymentData || []);
    }

    const { data: empData } = await supabase.from('employees').select('*');
    const empMap = {};
    (empData || []).forEach((e) => (empMap[e.id] = e));
    setEmployees(empMap);


    const { data: auditData } = await supabase
      .from('audit_log')
      .select('*')
      .order('changed_at', { ascending: false })
      .limit(200);
    setAuditLog(auditData || []);
  };

  const handleApprove = async (loan) => {
    const finalAmount = approvedAmounts[loan.id]
      ? parseFloat(approvedAmounts[loan.id])
      : loan.amount;

    const finalMonths = approvedMonths[loan.id]
      ? parseInt(approvedMonths[loan.id])
      : loan.months;

    const newMonthlyDeduction = loan.type === 'iou'
      ? finalAmount
      : finalAmount / finalMonths;

    await supabase
      .from('loans')
      .update({
        status: 'approved',
        approved_amount: finalAmount,
        months: finalMonths,
        monthly_deduction: newMonthlyDeduction,
        approved_date: new Date().toISOString(),
        decided_by: profile.id,
      })
      .eq('id', loan.id);

    const applicant = employees[loan.employee_id];
    if (applicant) {
      notifyHRDecision(applicant, { ...loan, approved_amount: finalAmount }, true);
    }

    fetchAll();
  };

  const handleDecline = async (loanId) => {
    const loan = loans.find((l) => l.id === loanId);

    await supabase
      .from('loans')
      .update({ status: 'declined', decided_by: profile.id })
      .eq('id', loanId);

    if (loan) {
      const applicant = employees[loan.employee_id];
      if (applicant) {
        notifyHRDecision(applicant, loan, false);
      }
    }

    fetchAll();
  };

  const startEditingProfile = (emp) => {
    setEditingEmployeeId(emp.id);
    setProfileForm({
      gender: emp.gender || '',
      address: emp.address || '',
      telephone_number: emp.telephone_number || '',
      marital_status: emp.marital_status || '',
      date_of_birth: emp.date_of_birth || '',
      bank_name: emp.bank_name || '',
      account_number: emp.account_number || '',
      account_name: emp.account_name || '',
      employment_status: emp.employment_status || 'active',
    });
  };

  const handleSaveEmployeeProfile = async (empId) => {
    const { error } = await supabase
      .from('employees')
      .update(profileForm)
      .eq('id', empId);

    if (!error) {
      setEditingEmployeeId(null);
      fetchAll();
    }
  };

  const handleExportCSV = () => {
    const headers = ['Employee', 'Staff ID', 'Type', 'Requested', 'Approved', 'Guarantor', 'Status', 'Decided By', 'Applied', 'Approved Date', 'Disbursed Date', 'Payments Made', 'Last Payment Date'];

    const rows = filteredHistory.map((loan) => [
      employeeName(loan.employee_id),
      employeeStaffId(loan.employee_id),
      loan.type === 'iou' ? 'IOU' : 'Loan',
      loan.amount,
      loan.approved_amount ?? '',
      employeeName(loan.guarantor_id),
      statusLabel(loan.status),
      loan.decided_by ? employeeName(loan.decided_by) : '',
      formatDate(loan.applied_date),
      formatDate(loan.approved_date),
      formatDate(loan.disbursed_date),
      paymentsMadeCount(loan.id),
      formatDate(lastPaymentDate(loan.id)),
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const monthLabel = exportMonth === 'all' ? '' : `_${monthNames[parseInt(exportMonth) - 1]}`;
    const yearLabel = exportYear === 'all' ? '' : `_${exportYear}`;
    const periodLabel = (monthLabel || yearLabel) ? `${monthLabel}${yearLabel}` : '_all_time';
    link.setAttribute('download', `loan_history${periodLabel}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const pending = loans.filter((l) => l.status === 'pending');
  const active = loans.filter((l) => ['approved', 'disbursed'].includes(l.status));
  const completed = loans.filter((l) => l.status === 'completed');
  const declined = loans.filter((l) => l.status === 'declined');
  const awaitingGuarantor = loans.filter((l) => ['awaiting_guarantor', 'guarantor_declined'].includes(l.status));

  const employeeName = (id) => employees[id]?.full_name || 'Unknown';
  const employeeStaffId = (id) => employees[id]?.staff_id || '—';

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const paymentsMadeCount = (loanId) => repayments.filter((r) => r.loan_id === loanId && r.paid).length;

  const lastPaymentDate = (loanId) => {
    const paidOnes = repayments.filter((r) => r.loan_id === loanId && r.paid && r.paid_date);
    if (paidOnes.length === 0) return null;
    return paidOnes.sort((a, b) => new Date(b.paid_date) - new Date(a.paid_date))[0].paid_date;
  };

  const statusLabel = (status) => {
    const labels = {
      awaiting_guarantor: 'Awaiting Guarantor',
      guarantor_declined: 'Guarantor Declined',
      pending: 'Pending HR Review',
      approved: 'Approved — Awaiting Payment',
      declined: 'Declined',
      disbursed: 'Disbursed',
      completed: 'Completed',
    };
    return labels[status] || status;
  };

  const filteredHistory = loans.filter((loan) => {
    if (searchTerm.trim()) {
      const name = employeeName(loan.employee_id).toLowerCase();
      const staffId = employeeStaffId(loan.employee_id).toLowerCase();
      const term = searchTerm.toLowerCase();
      if (!name.includes(term) && !staffId.includes(term)) return false;
    }

    if (exportYear !== 'all' || exportMonth !== 'all') {
      if (!loan.applied_date) return false;
      const date = new Date(loan.applied_date);
      if (exportYear !== 'all' && date.getFullYear() !== parseInt(exportYear)) return false;
      if (exportMonth !== 'all' && date.getMonth() + 1 !== parseInt(exportMonth)) return false;
    }

    return true;
  });

  // Build the list of years actually present in the data, for the year dropdown
  const availableYears = [...new Set(
    loans.filter((l) => l.applied_date).map((l) => new Date(l.applied_date).getFullYear())
  )].sort((a, b) => b - a);

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // Total company exposure = sum of all unpaid repayments across active loans
  const totalExposure = repayments
    .filter((r) => !r.paid)
    .reduce((sum, r) => sum + r.amount, 0);

  const tabList = [
    { id: 'pending', label: 'Pending Review', badge: pending.length },
    { id: 'guarantor', label: 'Awaiting Guarantor', badge: 0 },
    { id: 'active', label: 'Active', badge: 0 },
    { id: 'history', label: 'All Loan History', badge: 0 },
    { id: 'profiles', label: 'Employee Profiles', badge: 0 },
    { id: 'audit', label: 'Audit Log', badge: 0 },
  ];

  const tabTitles = {
    pending: 'Pending Review',
    guarantor: 'Awaiting Guarantor',
    active: 'Active Loans',
    history: 'All Loan History',
    profiles: 'Employee Profiles',
    audit: 'Audit Log',
  };

  return (
    <div className="app-shell">
      <Sidebar
        tabs={tabList}
        activeTab={tab}
        onTabChange={setTab}
        roleLabel="HR Admin"
        fullName={profile.full_name}
        onLogout={onLogout}
      />
      <div className="dashboard-container">
        <div className="dashboard-header">
          <h1>{tabTitles[tab]}</h1>
        </div>

      <div className="exposure-banner">
        <span>Total Outstanding Across All Employees</span>
        <strong>₦{totalExposure.toLocaleString()}</strong>
      </div>

      {tab === 'pending' && (
        <>
          <h2>Pending Requests — Guarantor Confirmed ({pending.length})</h2>
          {pending.length === 0 && <p>No requests ready for review.</p>}
          {pending.map((loan) => (
            <div key={loan.id} className="loan-card">
              <div className="loan-card-header">
                <strong>{employeeName(loan.employee_id)}</strong> ({employeeStaffId(loan.employee_id)}) — {loan.type === 'iou' ? 'IOU' : 'Loan'} — Requested ₦{loan.amount.toLocaleString()}
              </div>
              <p>Reason: {loan.reason}</p>
              <p>Guarantor: {employeeName(loan.guarantor_id)} ({employeeStaffId(loan.guarantor_id)})</p>
              <p>Requested period: {loan.months} month(s)</p>

              <label className="hr-amount-label">Approve amount (adjust if needed):</label>
              <input
                type="number"
                className="hr-amount-input"
                placeholder={loan.amount}
                value={approvedAmounts[loan.id] ?? ''}
                onChange={(e) => setApprovedAmounts({ ...approvedAmounts, [loan.id]: e.target.value })}
              />

              {loan.type === 'loan' && (
                <>
                  <label className="hr-amount-label">Approve repayment period (months):</label>
                  <select
                    className="hr-amount-input"
                    value={approvedMonths[loan.id] ?? loan.months}
                    onChange={(e) => setApprovedMonths({ ...approvedMonths, [loan.id]: e.target.value })}
                  >
                    <option value={1}>1 month</option>
                    <option value={2}>2 months</option>
                    <option value={3}>3 months</option>
                  </select>
                </>
              )}

              <div className="action-buttons">
                <button onClick={() => handleApprove(loan)} className="approve-btn">Approve</button>
                <button onClick={() => handleDecline(loan.id)} className="decline-btn">Decline</button>
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'guarantor' && (
        <>
          <h2>Awaiting Guarantor Confirmation ({awaitingGuarantor.length})</h2>
          {awaitingGuarantor.length === 0 && <p>Nothing waiting on a guarantor right now.</p>}
          {awaitingGuarantor.length > 0 && (
            <div className="table-wrapper">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Guarantor</th>
                    <th>Status</th>
                    <th>Applied</th>
                  </tr>
                </thead>
                <tbody>
                  {awaitingGuarantor.map((loan) => (
                    <tr key={loan.id}>
                      <td>{employeeName(loan.employee_id)}</td>
                      <td>{loan.type === 'iou' ? 'IOU' : 'Loan'}</td>
                      <td>₦{loan.amount.toLocaleString()}</td>
                      <td>{employeeName(loan.guarantor_id)}</td>
                      <td>
                        <span className={`status-badge status-${loan.status}`}>
                          {loan.status === 'guarantor_declined' ? 'Guarantor Declined' : 'Waiting on Guarantor'}
                        </span>
                      </td>
                      <td>{formatDate(loan.applied_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'active' && (
        <>
          <h2>Active, Completed &amp; Declined Loans ({active.length + completed.length + declined.length})</h2>
          {(active.length + completed.length + declined.length) === 0 && <p>No loans in this view yet.</p>}
          {(active.length + completed.length + declined.length) > 0 && (
            <div className="table-wrapper">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Type</th>
                    <th>Approved Amount</th>
                    <th>Status</th>
                    <th>Decided By</th>
                    <th>Approved Date</th>
                    <th>Disbursed Date</th>
                  </tr>
                </thead>
                <tbody>
                  {[...active, ...completed, ...declined].map((loan) => (
                    <tr key={loan.id}>
                      <td>{employeeName(loan.employee_id)}</td>
                      <td>{loan.type === 'iou' ? 'IOU' : 'Loan'}</td>
                      <td>₦{(loan.approved_amount ?? loan.amount).toLocaleString()}</td>
                      <td><span className={`status-badge status-${loan.status}`}>{statusLabel(loan.status)}</span></td>
                      <td>{loan.decided_by ? employeeName(loan.decided_by) : '—'}</td>
                      <td>{formatDate(loan.approved_date)}</td>
                      <td>{formatDate(loan.disbursed_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'history' && (
        <>
          <h2>All Employees — Full Loan History ({filteredHistory.length})</h2>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="search-input"
              placeholder="Search by employee name or staff ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />

            <select className="hr-amount-input" value={exportMonth} onChange={(e) => setExportMonth(e.target.value)} style={{ width: 'auto', marginBottom: 0 }}>
              <option value="all">All Months</option>
              {monthNames.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>

            <select className="hr-amount-input" value={exportYear} onChange={(e) => setExportYear(e.target.value)} style={{ width: 'auto', marginBottom: 0 }}>
              <option value="all">All Years</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>

            <button className="apply-btn small-btn" onClick={handleExportCSV} style={{ marginTop: 0 }}>
              Export to CSV
            </button>
          </div>

          <div className="table-wrapper">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Staff ID</th>
                  <th>Type</th>
                  <th>Requested</th>
                  <th>Approved</th>
                  <th>Guarantor</th>
                  <th>Status</th>
                  <th>Decided By</th>
                  <th>Applied</th>
                  <th>Approved Date</th>
                  <th>Disbursed Date</th>
                  <th>Payments Made</th>
                  <th>Last Payment Date</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((loan) => (
                  <tr key={loan.id}>
                    <td>{employeeName(loan.employee_id)}</td>
                    <td>{employeeStaffId(loan.employee_id)}</td>
                    <td>{loan.type === 'iou' ? 'IOU' : 'Loan'}</td>
                    <td>₦{loan.amount.toLocaleString()}</td>
                    <td>{loan.approved_amount ? `₦${loan.approved_amount.toLocaleString()}` : '—'}</td>
                    <td>{employeeName(loan.guarantor_id)}</td>
                    <td><span className={`status-badge status-${loan.status}`}>{statusLabel(loan.status)}</span></td>
                    <td>{loan.decided_by ? employeeName(loan.decided_by) : '—'}</td>
                    <td>{formatDate(loan.applied_date)}</td>
                    <td>{formatDate(loan.approved_date)}</td>
                    <td>{formatDate(loan.disbursed_date)}</td>
                    <td>{paymentsMadeCount(loan.id)}</td>
                    <td>{formatDate(lastPaymentDate(loan.id))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'profiles' && (
        <>
          <h2>Employee Profiles</h2>
          <input
            type="text"
            className="search-input"
            placeholder="Search by name or staff ID..."
            value={profileSearchTerm}
            onChange={(e) => setProfileSearchTerm(e.target.value)}
          />

          {Object.values(employees)
            .filter((emp) => emp.role === 'employee')
            .filter((emp) => {
              if (!profileSearchTerm.trim()) return true;
              const term = profileSearchTerm.toLowerCase();
              return emp.full_name?.toLowerCase().includes(term) || emp.staff_id?.toLowerCase().includes(term);
            })
            .map((emp) => {
              const hasActiveLoan = loans.some(
                (l) => l.employee_id === emp.id &&
                ['awaiting_guarantor', 'pending', 'approved', 'disbursed'].includes(l.status)
              );
              return (
              <div key={emp.id} className="loan-card">
                <div className="loan-card-header">
                  <strong>{emp.full_name}</strong> ({emp.staff_id}) — {emp.department}
                  {emp.employment_status === 'exited' && (
                    <span className="status-badge status-declined">EXITED</span>
                  )}
                </div>

                {emp.employment_status === 'exited' && hasActiveLoan && (
                  <div className="policy-text" style={{ borderLeftColor: 'var(--decline-red)', background: '#FDEBEB' }}>
                    <p><strong>⚠ Outstanding balance:</strong> this employee has exited but still has an active loan/IOU. Please settle this in their final pay before closing their record.</p>
                  </div>
                )}

                {editingEmployeeId === emp.id ? (
                  <div className="apply-form" style={{ marginTop: '10px' }}>
                    <label>Employment Status</label>
                    <select value={profileForm.employment_status} onChange={(e) => setProfileForm({ ...profileForm, employment_status: e.target.value })}>
                      <option value="active">Active</option>
                      <option value="exited">Exited</option>
                    </select>

                    <label>Gender</label>
                    <select value={profileForm.gender} onChange={(e) => setProfileForm({ ...profileForm, gender: e.target.value })}>
                      <option value="">Select</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>

                    <label>Date of Birth</label>
                    <input type="date" value={profileForm.date_of_birth} onChange={(e) => setProfileForm({ ...profileForm, date_of_birth: e.target.value })} />

                    <label>Marital Status</label>
                    <select value={profileForm.marital_status} onChange={(e) => setProfileForm({ ...profileForm, marital_status: e.target.value })}>
                      <option value="">Select</option>
                      <option value="Single">Single</option>
                      <option value="Married">Married</option>
                      <option value="Divorced">Divorced</option>
                      <option value="Widowed">Widowed</option>
                    </select>

                    <label>Telephone Number</label>
                    <input type="text" value={profileForm.telephone_number} onChange={(e) => setProfileForm({ ...profileForm, telephone_number: e.target.value })} />

                    <label>Address</label>
                    <textarea rows="3" value={profileForm.address} onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })} />

                    <label>Bank Name</label>
                    <input type="text" value={profileForm.bank_name} onChange={(e) => setProfileForm({ ...profileForm, bank_name: e.target.value })} />

                    <label>Account Number</label>
                    <input type="text" value={profileForm.account_number} onChange={(e) => setProfileForm({ ...profileForm, account_number: e.target.value })} />

                    <label>Account Name</label>
                    <input type="text" value={profileForm.account_name} onChange={(e) => setProfileForm({ ...profileForm, account_name: e.target.value })} />

                    <div className="action-buttons">
                      <button className="approve-btn" onClick={() => handleSaveEmployeeProfile(emp.id)}>Save</button>
                      <button className="decline-btn" onClick={() => setEditingEmployeeId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="profile-grid" style={{ marginTop: '10px' }}>
                      <div><strong>Gender:</strong> {emp.gender || '—'}</div>
                      <div><strong>DOB:</strong> {emp.date_of_birth || '—'}</div>
                      <div><strong>Marital Status:</strong> {emp.marital_status || '—'}</div>
                      <div><strong>Telephone:</strong> {emp.telephone_number || '—'}</div>
                      <div className="full-width"><strong>Address:</strong> {emp.address || '—'}</div>
                      <div><strong>Bank:</strong> {emp.bank_name || '—'}</div>
                      <div><strong>Account No:</strong> {emp.account_number || '—'}</div>
                      <div><strong>Account Name:</strong> {emp.account_name || '—'}</div>
                    </div>
                    <button className="apply-btn small-btn" onClick={() => startEditingProfile(emp)}>Edit Profile</button>
                  </>
                )}
              </div>
              );
            })}
        </>
      )}

      {tab === 'audit' && (
        <>
          <h2>Audit Log — Every Status Change</h2>
          {auditLog.length === 0 && <p>No status changes recorded yet.</p>}
          <div className="table-wrapper">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Changed By</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.map((entry) => {
                  const relatedLoan = loans.find((l) => l.id === entry.loan_id);
                  return (
                    <tr key={entry.id}>
                      <td>{relatedLoan ? employeeName(relatedLoan.employee_id) : '—'}</td>
                      <td>{statusLabel(entry.old_status) || '—'}</td>
                      <td>{statusLabel(entry.new_status)}</td>
                      <td>{entry.changed_by ? employeeName(entry.changed_by) : 'System'}</td>
                      <td>{formatDate(entry.changed_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      </div>
    </div>
  );
}

export default HRDashboard;
