import { useEffect, useState } from 'react';
import api, { errorMessage } from '../api';
import { dateOnly, money } from '../format';

// Default validity: 30 days from today.
function defaultValidUntil() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

// PREVIEW ONLY: the same maths as the backend so the user sees a total while typing.
// The saved numbers always come from the backend, which ignores anything calculated here.
function previewLineAmount(row) {
  const base = Number(row.quantity) * Number(row.unit_price);
  const taxable = base - (base * Number(row.discount_pct)) / 100;
  return taxable + (taxable * Number(row.gst_pct)) / 100 || 0;
}

export default function Quotations() {
  const [enquiries, setEnquiries] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [enquiryId, setEnquiryId] = useState('');
  const [validUntil, setValidUntil] = useState(defaultValidUntil());
  const [rows, setRows] = useState([]);

  async function loadData() {
    const [enquiryResponse, quotationResponse] = await Promise.all([api.get('/enquiries'), api.get('/quotations')]);
    setEnquiries(enquiryResponse.data);
    setQuotations(quotationResponse.data);
  }

  // Runs an action and shows the backend's error message if it fails.
  async function run(action) {
    setError('');
    setMessage('');
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    run(loadData);
  }, []);

  // Choosing an enquiry pre-fills its products with the base price, 0% discount and 18% GST.
  function selectEnquiry(id) {
    setEnquiryId(id);
    const enquiry = enquiries.find((e) => String(e.id) === id);
    setRows(
      enquiry
        ? enquiry.items.map((item) => ({
            product_id: item.product_id,
            label: `${item.product.code} - ${item.product.name}`,
            quantity: item.quantity,
            unit_price: Number(item.product.base_price),
            discount_pct: 0,
            gst_pct: 18,
          }))
        : []
    );
  }

  function changeRow(index, field, value) {
    setRows(rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function saveQuotation(event) {
    event.preventDefault();
    run(async () => {
      const { data } = await api.post('/quotations', {
        enquiry_id: Number(enquiryId),
        valid_until: validUntil,
        items: rows.map((row) => ({
          product_id: row.product_id,
          quantity: Number(row.quantity),
          unit_price: Number(row.unit_price),
          discount_pct: Number(row.discount_pct),
          gst_pct: Number(row.gst_pct),
        })),
      });
      setMessage(`Saved ${data.quotation_no}. Total calculated by the backend: ${money(data.grand_total)}`);
      setEnquiryId('');
      setRows([]);
      await loadData();
    });
  }

  function changeStatus(quotation, status) {
    run(async () => {
      await api.patch(`/quotations/${quotation.id}/status`, { status });
      await loadData();
    });
  }

  function convertToOrder(quotation) {
    run(async () => {
      const { data } = await api.post(`/quotations/${quotation.id}/convert`);
      setMessage(`Sales order ${data.order_no} created from ${quotation.quotation_no}`);
      await loadData();
    });
  }

  const previewTotal = rows.reduce((sum, row) => sum + previewLineAmount(row), 0);
  const quotableEnquiries = enquiries.filter((e) => e.status === 'NEW' || e.status === 'QUOTED');

  return (
    <div>
      <h2>Quotations</h2>
      {error && <div className="banner error">{error}</div>}
      {message && <div className="banner success">{message}</div>}

      <form className="card" onSubmit={saveQuotation}>
        <h3>New quotation</h3>
        <div className="row">
          <label>
            Enquiry
            <select value={enquiryId} onChange={(e) => selectEnquiry(e.target.value)} required>
              <option value="">Select enquiry</option>
              {quotableEnquiries.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.enquiry_no} - {e.customer.company_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Valid until
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} required />
          </label>
        </div>

        {rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Unit price</th>
                  <th>Discount %</th>
                  <th>GST %</th>
                  <th>Preview amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.product_id}>
                    <td>{row.label}</td>
                    <td><input type="number" min="1" value={row.quantity} onChange={(e) => changeRow(index, 'quantity', e.target.value)} required /></td>
                    <td><input type="number" min="0" step="0.01" value={row.unit_price} onChange={(e) => changeRow(index, 'unit_price', e.target.value)} required /></td>
                    <td><input type="number" min="0" max="100" step="0.01" value={row.discount_pct} onChange={(e) => changeRow(index, 'discount_pct', e.target.value)} required /></td>
                    <td><input type="number" min="0" max="100" step="0.01" value={row.gst_pct} onChange={(e) => changeRow(index, 'gst_pct', e.target.value)} required /></td>
                    <td>{money(previewLineAmount(row))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="5">Preview total (the backend calculates the final total when you save)</td>
                  <td>{money(previewTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <button type="submit" disabled={rows.length === 0}>Save quotation</button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Quotation no</th>
              <th>Enquiry</th>
              <th>Customer</th>
              <th>Valid until</th>
              <th>Total</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {quotations.map((q) => (
              <tr key={q.id}>
                <td>{q.quotation_no}</td>
                <td>{q.enquiry.enquiry_no}</td>
                <td>{q.customer.company_name}</td>
                <td>{dateOnly(q.valid_until)}</td>
                <td>{money(q.grand_total)}</td>
                <td><span className={`badge ${q.status}`}>{q.status}</span></td>
                <td className="actions">
                  {q.status === 'DRAFT' && <button onClick={() => changeStatus(q, 'SENT')}>Send</button>}
                  {q.status === 'SENT' && <button onClick={() => changeStatus(q, 'ACCEPTED')}>Accept</button>}
                  {q.status === 'SENT' && <button className="danger" onClick={() => changeStatus(q, 'REJECTED')}>Reject</button>}
                  {q.status === 'ACCEPTED' && !q.sales_order && <button onClick={() => convertToOrder(q)}>Convert to order</button>}
                  {q.sales_order && <span>Order {q.sales_order.order_no}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
