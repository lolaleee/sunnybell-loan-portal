import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import Sidebar from './Sidebar';
import { notifyDisbursement, notifyLoanCompleted } from './notifications';

function ContractorDashboard({ profile, onLogout }) {
  const [tab, setTab] = useState('queue');
  const [loans, setLoans] = useState([]);
  const [repayments, setRepayments] = useState([]);
  const [employees, setEmployees] = useState({});
  const [actionError, setActionError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const [exportMonth, setExportMonth] = useState('all');
  const [exportYear, setExportYear] = useState('all');
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const [collectedAmounts, setCollectedAmounts] = useState({});

  useEffect(() => {
    fetchAll();

    // Auto-refresh every 30 seconds so payments marked elsewhere
    // (e.g. HR marking a repayment paid) show up without a manual reload
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchAll = async () => {
    const { data: loanData } = await supabase
      .from('loans')
      .select('*')
      .in('status', ['approved', 'disbursed', 'completed'])
      .order('approved_date', { ascending: false });

    setLoans(loanData || []);

    if (loanData && loanData.length > 0) {
      const loanIds = loanData.map((l) => l.id);
      const { data: repaymentData } = await supabase
        .from('repayments')
        .select('*')
        .in('loan_id', loanIds)
        .order('due_date', { ascending: true });
      setRepayments(repaymentData || []);
    } else {
      setRepayments([]);
    }

    const { data: empData } = await supabase.from('employees').select('*');
    const empMap = {};
    (empData || []).forEach((e) => (empMap[e.id] = e));
    setEmployees(empMap);

    setLastRefreshed(new Date());
  };

  const handleRecordPayment = async (repaymentId, alreadyCollected, remainingDue, loanId) => {
    const entered = collectedAmounts[repaymentId];
    const newAmount = entered ? parseFloat(entered) : remainingDue;
    const totalCollected = Number(alreadyCollected || 0) + newAmount;

    if (!window.confirm(`Confirm ₦${Number(newAmount).toLocaleString()} was collected just now (total so far: ₦${totalCollected.toLocaleString()})?`)) return;

    const { error } = await supabase
      .from('repayments')
      .update({ amount_collected: totalCollected, recorded_by: profile.id })
      .eq('id', repaymentId);

    if (error) {
      setActionError(error.message);
    } else {
      setActionError('');
      setCollectedAmounts((prev) => ({ ...prev, [repaymentId]: '' }));

      // Check if this payment just completed the loan, and notify if so
      const { data: updatedLoan } = await supabase.from('loans').select('*').eq('id', loanId).single();
      if (updatedLoan && updatedLoan.status === 'completed') {
        const applicant = employees[updatedLoan.employee_id];
        if (applicant) notifyLoanCompleted(applicant, updatedLoan);
      }
    }
    fetchAll();
  };

  const handleDisburse = async (loanId) => {
    if (!window.confirm('Confirm that payment has actually been sent before marking this as disbursed.')) return;
    const { error } = await supabase.from('loans').update({ status: 'disbursed' }).eq('id', loanId);
    setActionError(error ? error.message : '');

    if (!error) {
      const loan = loans.find((l) => l.id === loanId);
      const applicant = loan ? employees[loan.employee_id] : null;
      if (applicant && loan) notifyDisbursement(applicant, loan);
    }

    fetchAll();
  };

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const employeeName = (id) => employees[id]?.full_name || 'Unknown';
  const employeeStaffId = (id) => employees[id]?.staff_id || '—';

  // Guards against Supabase returning numeric columns as strings
  const fmt = (value) => Number(value || 0).toLocaleString();

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const awaitingPayment = loans.filter((l) => l.status === 'approved');
  const currentlyOnLoan = loans.filter((l) => l.status === 'disbursed');
  const alreadyPaid = loans.filter((l) => l.status === 'completed');

  const getRepaymentsFor = (loanId) => repayments.filter((r) => r.loan_id === loanId);

  const balanceInfo = (loan) => {
    const loanRepayments = getRepaymentsFor(loan.id);
    // Anchor the total to the loan's actual approved amount, not the sum
    // of repayment rows — shortfall rollovers shift amounts between rows,
    // which would double-count if we summed them directly.
    const total = Number(loan.approved_amount ?? loan.amount ?? 0);
    const paid = loanRepayments.reduce((sum, r) => sum + Number(r.amount_collected || 0), 0);
    const remaining = Math.max(total - paid, 0);
    const nextDue = loanRepayments.find((r) => !r.paid);
    const lastPaid = loanRepayments.filter((r) => r.paid && r.paid_date).sort((a, b) => new Date(b.paid_date) - new Date(a.paid_date))[0];
    return { total, paid, remaining, nextDue, lastPaid };
  };

  // Total amount still waiting to be paid out — helps plan the day's transfers
  const totalAwaiting = awaitingPayment.reduce(
    (sum, l) => sum + Number(l.approved_amount ?? l.amount ?? 0),
    0
  );

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const matchesSearch = (loan) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const name = employeeName(loan.employee_id).toLowerCase();
    const staffId = employeeStaffId(loan.employee_id).toLowerCase();
    return name.includes(term) || staffId.includes(term);
  };

  const matchesPeriod = (loan) => {
    if (exportYear === 'all' && exportMonth === 'all') return true;
    if (!loan.disbursed_date) return false;
    const date = new Date(loan.disbursed_date);
    if (exportYear !== 'all' && date.getFullYear() !== parseInt(exportYear)) return false;
    if (exportMonth !== 'all' && date.getMonth() + 1 !== parseInt(exportMonth)) return false;
    return true;
  };

  const filteredActive = currentlyOnLoan.filter((l) => matchesSearch(l));
  const filteredCompleted = alreadyPaid.filter((l) => matchesSearch(l) && matchesPeriod(l));
  const filteredHistory = loans.filter((l) => matchesSearch(l) && matchesPeriod(l));

  const availableYears = [...new Set(
    [...currentlyOnLoan, ...alreadyPaid].filter((l) => l.disbursed_date).map((l) => new Date(l.disbursed_date).getFullYear())
  )].sort((a, b) => b - a);

  const handleExportCSV = (loanList, filenamePrefix) => {
    const headers = ['Employee', 'Staff ID', 'Type', 'Guarantor', 'Approved Amount', 'Total', 'Paid So Far', 'Remaining', 'Approved Date', 'Disbursed Date', 'Last Payment Date', 'Status'];

    const rows = loanList.map((loan) => {
      const { total, paid, remaining, lastPaid } = balanceInfo(loan);
      return [
        employeeName(loan.employee_id),
        employeeStaffId(loan.employee_id),
        loan.type === 'iou' ? 'IOU' : 'Loan',
        employeeName(loan.guarantor_id),
        fmt(loan.approved_amount ?? loan.amount),
        fmt(total),
        fmt(paid),
        fmt(remaining),
        formatDate(loan.approved_date),
        formatDate(loan.disbursed_date),
        lastPaid ? formatDate(lastPaid.paid_date) : '—',
        loan.status === 'completed' ? 'Fully Repaid' : 'Repaying',
      ];
    });

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const monthLabel = exportMonth === 'all' ? '' : `_${monthNames[parseInt(exportMonth) - 1]}`;
    const yearLabel = exportYear === 'all' ? '' : `_${exportYear}`;
    const periodLabel = (monthLabel || yearLabel) ? `${monthLabel}${yearLabel}` : '_all_time';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${filenamePrefix}${periodLabel}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const tabList = [
    { id: 'queue', label: 'Awaiting Payment', badge: awaitingPayment.length },
    { id: 'active', label: 'Employees Currently on Loan', badge: 0 },
    { id: 'repayments', label: 'Track Repayments', badge: 0 },
    { id: 'completed', label: 'Fully Repaid', badge: 0 },
    { id: 'history', label: 'All Loan History', badge: 0 },
  ];

  const tabTitles = {
    queue: 'Awaiting Payment',
    active: 'Employees Currently on Loan',
    repayments: 'Track Repayments',
    completed: 'Fully Repaid',
    history: 'All Loan History',
  };

  return (
    <div className="app-shell">
      <Sidebar
        tabs={tabList}
        activeTab={tab}
        onTabChange={setTab}
        roleLabel="Contractor"
        fullName={profile.full_name}
        onLogout={onLogout}
      />
      <div className="dashboard-container">
        <div className="dashboard-header">
          <h1>{tabTitles[tab]}</h1>
          <button className="link-btn" onClick={fetchAll} style={{ marginTop: 0 }}>
            Refresh (last updated {lastRefreshed.toLocaleTimeString()})
          </button>
        </div>

        {actionError && <div className="form-message" style={{ borderLeftColor: 'var(--decline-red)', background: '#FDEBEB', color: 'var(--decline-red)' }}>{actionError}</div>}

        {tab === 'queue' && (
          <>
            <div className="exposure-banner">
              <span>Total Waiting to Be Paid Out</span>
              <strong>₦{fmt(totalAwaiting)}</strong>
            </div>

            <h2>Awaiting Payment ({awaitingPayment.length})</h2>
            {awaitingPayment.length === 0 && <p>Nothing waiting for payment right now.</p>}
            {awaitingPayment.map((loan) => (
              <div key={loan.id} className="loan-card">
                <div className="loan-card-header">
                  <strong>{employeeName(loan.employee_id)}</strong> — {loan.type === 'iou' ? 'IOU' : 'Loan'} — ₦{fmt(loan.approved_amount ?? loan.amount)}
                </div>
                <p>Approved on: {formatDate(loan.approved_date)}</p>

                <div className="bank-details-box">
                  <p><strong>Pay into:</strong></p>
                  <p>Bank: {employees[loan.employee_id]?.bank_name || 'Not on file'}</p>
                  <p>
                    Account No: {employees[loan.employee_id]?.account_number || 'Not on file'}
                    {employees[loan.employee_id]?.account_number && (
                      <button className="copy-btn" onClick={() => handleCopy(employees[loan.employee_id].account_number, loan.id)}>
                        {copiedId === loan.id ? 'Copied!' : 'Copy'}
                      </button>
                    )}
                  </p>
                  <p>Account Name: {employees[loan.employee_id]?.account_name || 'Not on file'}</p>
                </div>

                <div className="action-buttons">
                  <button onClick={() => handleDisburse(loan.id)} className="approve-btn">
                    Mark as Paid / Disbursed
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        {tab === 'active' && (
          <>
            <h2>Employees Currently on Loan ({filteredActive.length})</h2>

            <input
              type="text"
              className="search-input"
              placeholder="Search by employee name or staff ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />

            {filteredActive.length === 0 && <p>No one matching this view is currently repaying a loan.</p>}
            {filteredActive.length > 0 && (
              <div className="table-wrapper">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Staff ID</th>
                      <th>Type</th>
                      <th>Guarantor</th>
                      <th>Approved Amount</th>
                      <th>Paid So Far</th>
                      <th>Remaining</th>
                      <th>Approved Date</th>
                      <th>Disbursed Date</th>
                      <th>Next Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredActive.map((loan) => {
                      const { paid, remaining, nextDue } = balanceInfo(loan);
                      const overdue = nextDue && new Date(nextDue.due_date) < new Date(new Date().toDateString());
                      return (
                        <tr key={loan.id}>
                          <td>{employeeName(loan.employee_id)}</td>
                          <td>{employeeStaffId(loan.employee_id)}</td>
                          <td>{loan.type === 'iou' ? 'IOU' : 'Loan'}</td>
                          <td>{employeeName(loan.guarantor_id)}</td>
                          <td>₦{fmt(loan.approved_amount ?? loan.amount)}</td>
                          <td style={{ color: 'var(--approve-green)' }}>₦{fmt(paid)}</td>
                          <td style={{ color: 'var(--decline-red)' }}>₦{fmt(remaining)}</td>
                          <td>{formatDate(loan.approved_date)}</td>
                          <td>{formatDate(loan.disbursed_date)}</td>
                          <td>
                            {nextDue ? formatDate(nextDue.due_date) : '—'}
                            {overdue && <span className="overdue-tag">OVERDUE</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {tab === 'repayments' && (
          <>
            <h2>Track Repayments</h2>
            {currentlyOnLoan.length === 0 && <p>No loans currently being repaid.</p>}
            {currentlyOnLoan.map((loan) => (
              <div key={loan.id} className="loan-card">
                <div className="loan-card-header">
                  <strong>{employeeName(loan.employee_id)}</strong> — {loan.type === 'iou' ? 'IOU' : 'Loan'} — ₦{fmt(loan.approved_amount ?? loan.amount)}
                </div>
                <div className="repayment-list">
                  {getRepaymentsFor(loan.id).map((r) => {
                    const overdue = !r.paid && new Date(r.due_date) < new Date(new Date().toDateString());
                    const wasPartial = r.amount_collected > 0 && r.amount_collected < r.amount;
                    return (
                      <div key={r.id} className={`repayment-row-hr ${overdue ? 'overdue' : ''}`}>
                        <span>
                          {formatDate(r.due_date)} — Due ₦{fmt(r.amount)}
                          {wasPartial && !r.paid && (
                            <span className="overdue-tag" style={{ background: 'var(--concept-gold)', color: 'var(--ink-navy)' }}>
                              {loan.type === 'iou'
                                ? `PARTIAL: ₦${fmt(r.amount_collected)} collected, ₦${fmt(r.amount - r.amount_collected)} still outstanding`
                                : `PARTIAL: ₦${fmt(r.amount_collected)} collected, ₦${fmt(r.amount - r.amount_collected)} rolled forward`}
                            </span>
                          )}
                          {overdue && <span className="overdue-tag">OVERDUE</span>}
                        </span>
                        {r.paid ? (
                          <span className="paid-tag">
                            ✓ Collected ₦{fmt(r.amount_collected)} {r.paid_date ? `on ${formatDate(r.paid_date)}` : ''}
                            {wasPartial && loan.type === 'loan' && ' (shortfall moved to next month)'}
                          </span>
                        ) : (
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                              type="number"
                              placeholder={`₦${fmt(r.amount - Number(r.amount_collected || 0))}`}
                              value={collectedAmounts[r.id] || ''}
                              onChange={(e) => setCollectedAmounts({ ...collectedAmounts, [r.id]: e.target.value })}
                              style={{ width: '120px', padding: '6px 10px', border: '1.5px solid var(--hairline)', borderRadius: '4px', fontSize: '12px' }}
                            />
                            <button className="approve-btn small-btn" onClick={() => handleRecordPayment(r.id, r.amount_collected, r.amount - Number(r.amount_collected || 0), loan.id)}>Record Payment</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}

        {tab === 'completed' && (
          <>
            <h2>Fully Repaid ({filteredCompleted.length})</h2>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              <select className="hr-amount-input" value={exportMonth} onChange={(e) => setExportMonth(e.target.value)} style={{ width: 'auto', marginBottom: 0 }}>
                <option value="all">All Months</option>
                {monthNames.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <select className="hr-amount-input" value={exportYear} onChange={(e) => setExportYear(e.target.value)} style={{ width: 'auto', marginBottom: 0 }}>
                <option value="all">All Years</option>
                {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              {filteredCompleted.length > 0 && (
                <button className="apply-btn small-btn" onClick={() => handleExportCSV(filteredCompleted, 'fully_repaid')} style={{ marginTop: 0 }}>
                  Export to CSV
                </button>
              )}
            </div>

            {filteredCompleted.length === 0 && <p>No completed loans in this view yet.</p>}
            {filteredCompleted.length > 0 && (
              <div className="table-wrapper">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Staff ID</th>
                      <th>Type</th>
                      <th>Guarantor</th>
                      <th>Amount Repaid</th>
                      <th>Approved Date</th>
                      <th>Disbursed Date</th>
                      <th>Last Payment Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCompleted.map((loan) => {
                      const { total, lastPaid } = balanceInfo(loan);
                      return (
                        <tr key={loan.id}>
                          <td>{employeeName(loan.employee_id)}</td>
                          <td>{employeeStaffId(loan.employee_id)}</td>
                          <td>{loan.type === 'iou' ? 'IOU' : 'Loan'}</td>
                          <td>{employeeName(loan.guarantor_id)}</td>
                          <td>₦{fmt(total)}</td>
                          <td>{formatDate(loan.approved_date)}</td>
                          <td>{formatDate(loan.disbursed_date)}</td>
                          <td>{lastPaid ? formatDate(lastPaid.paid_date) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {tab === 'history' && (
          <>
            <h2>All Loan History ({filteredHistory.length})</h2>

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
                {monthNames.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <select className="hr-amount-input" value={exportYear} onChange={(e) => setExportYear(e.target.value)} style={{ width: 'auto', marginBottom: 0 }}>
                <option value="all">All Years</option>
                {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              {filteredHistory.length > 0 && (
                <button className="apply-btn small-btn" onClick={() => handleExportCSV(filteredHistory, 'all_loan_history')} style={{ marginTop: 0 }}>
                  Export to CSV
                </button>
              )}
            </div>

            {filteredHistory.length === 0 && <p>No loan records in this view yet.</p>}
            {filteredHistory.length > 0 && (
              <div className="table-wrapper">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Staff ID</th>
                      <th>Type</th>
                      <th>Guarantor</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Paid So Far</th>
                      <th>Remaining</th>
                      <th>Approved Date</th>
                      <th>Disbursed Date</th>
                      <th>Last Payment Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistory.map((loan) => {
                      const { paid, remaining, lastPaid } = balanceInfo(loan);
                      return (
                        <tr key={loan.id}>
                          <td>{employeeName(loan.employee_id)}</td>
                          <td>{employeeStaffId(loan.employee_id)}</td>
                          <td>{loan.type === 'iou' ? 'IOU' : 'Loan'}</td>
                          <td>{employeeName(loan.guarantor_id)}</td>
                          <td>₦{fmt(loan.approved_amount ?? loan.amount)}</td>
                          <td>
                            <span className={`status-badge status-${loan.status}`}>
                              {loan.status === 'approved' ? 'Awaiting Payment' : loan.status === 'disbursed' ? 'Repaying' : 'Fully Repaid'}
                            </span>
                          </td>
                          <td>₦{fmt(paid)}</td>
                          <td>₦{fmt(remaining)}</td>
                          <td>{formatDate(loan.approved_date)}</td>
                          <td>{formatDate(loan.disbursed_date)}</td>
                          <td>{lastPaid ? formatDate(lastPaid.paid_date) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ContractorDashboard;
