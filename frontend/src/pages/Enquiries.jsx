import { useEffect, useState } from 'react';
import api, { errorMessage } from '../api';
import { dateOnly } from '../format';

const emptyCustomer = { company_name: '', contact_person: '', mobile: '', city: '', email: '' };
const today = () => new Date().toISOString().slice(0, 10);

export default function Enquiries() {
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [enquiries, setEnquiries] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // The enquiry form
  const [customerId, setCustomerId] = useState('');
  const [enquiryDate, setEnquiryDate] = useState(today());
  const [requiredDate, setRequiredDate] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState([{ product_id: '', quantity: 1 }]);

  // null = the "new customer" form is hidden
  const [newCustomer, setNewCustomer] = useState(null);

  async function loadEnquiries() {
    const { data } = await api.get('/enquiries');
    setEnquiries(data);
  }

  async function loadCustomers() {
    const { data } = await api.get('/customers');
    setCustomers(data);
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
    run(async () => {
      await Promise.all([loadEnquiries(), loadCustomers()]);
      const { data } = await api.get('/products');
      setProducts(data);
    });
  }, []);

  function changeRow(index, field, value) {
    setRows(rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function createEnquiry(event) {
    event.preventDefault();
    run(async () => {
      const body = {
        customer_id: Number(customerId),
        enquiry_date: enquiryDate,
        items: rows.map((row) => ({ product_id: Number(row.product_id), quantity: Number(row.quantity) })),
      };
      if (requiredDate) body.required_date = requiredDate;
      if (notes) body.notes = notes;

      const { data } = await api.post('/enquiries', body);
      setRows([{ product_id: '', quantity: 1 }]);
      setNotes('');
      setRequiredDate('');
      await loadEnquiries();
      setMessage(`Enquiry ${data.enquiry_no} created`);
    });
  }

  function createCustomer(event) {
    event.preventDefault();
    run(async () => {
      // Empty optional fields are left out, otherwise the backend would reject "" as an invalid email.
      const body = Object.fromEntries(Object.entries(newCustomer).filter(([, value]) => value !== ''));
      const { data } = await api.post('/customers', body);
      await loadCustomers();
      setCustomerId(String(data.id));
      setNewCustomer(null);
      setMessage(`Customer ${data.company_name} created`);
    });
  }

  function markLost(enquiry) {
    run(async () => {
      await api.patch(`/enquiries/${enquiry.id}/status`, { status: 'LOST' });
      await loadEnquiries();
    });
  }

  return (
    <div>
      <h2>Enquiries</h2>
      {error && <div className="banner error">{error}</div>}
      {message && <div className="banner success">{message}</div>}

      <form className="card" onSubmit={createEnquiry}>
        <h3>New enquiry</h3>
        <div className="row">
          <label>
            Customer
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
              <option value="">Select customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company_name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary" onClick={() => setNewCustomer(emptyCustomer)}>
            + New customer
          </button>
          <label>
            Enquiry date
            <input type="date" value={enquiryDate} onChange={(e) => setEnquiryDate(e.target.value)} required />
          </label>
          <label>
            Required by
            <input type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} />
          </label>
        </div>
        <label>
          Notes
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <h4>Products</h4>
        {rows.map((row, index) => (
          <div className="row" key={index}>
            <select value={row.product_id} onChange={(e) => changeRow(index, 'product_id', e.target.value)} required>
              <option value="">Select product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} - {p.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="1"
              value={row.quantity}
              onChange={(e) => changeRow(index, 'quantity', e.target.value)}
              required
            />
            {rows.length > 1 && (
              <button type="button" className="secondary" onClick={() => setRows(rows.filter((_, i) => i !== index))}>
                Remove
              </button>
            )}
          </div>
        ))}
        <div className="row">
          <button type="button" className="secondary" onClick={() => setRows([...rows, { product_id: '', quantity: 1 }])}>
            + Add product
          </button>
          <button type="submit">Create enquiry</button>
        </div>
      </form>

      {newCustomer && (
        <form className="card" onSubmit={createCustomer}>
          <h3>New customer</h3>
          <div className="row">
            <input placeholder="Company name" value={newCustomer.company_name} required
              onChange={(e) => setNewCustomer({ ...newCustomer, company_name: e.target.value })} />
            <input placeholder="Contact person" value={newCustomer.contact_person} required
              onChange={(e) => setNewCustomer({ ...newCustomer, contact_person: e.target.value })} />
            <input placeholder="Mobile" value={newCustomer.mobile} required
              onChange={(e) => setNewCustomer({ ...newCustomer, mobile: e.target.value })} />
            <input placeholder="City (optional)" value={newCustomer.city}
              onChange={(e) => setNewCustomer({ ...newCustomer, city: e.target.value })} />
            <input placeholder="Email (optional)" type="email" value={newCustomer.email}
              onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} />
          </div>
          <div className="row">
            <button type="submit">Save customer</button>
            <button type="button" className="secondary" onClick={() => setNewCustomer(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Enquiry no</th>
              <th>Customer</th>
              <th>Date</th>
              <th>Status</th>
              <th>Items</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {enquiries.map((e) => (
              <tr key={e.id}>
                <td>{e.enquiry_no}</td>
                <td>{e.customer.company_name}</td>
                <td>{dateOnly(e.enquiry_date)}</td>
                <td><span className={`badge ${e.status}`}>{e.status}</span></td>
                <td>{e.items.length}</td>
                <td>
                  {(e.status === 'NEW' || e.status === 'QUOTED') && (
                    <button className="secondary" onClick={() => markLost(e)}>Mark lost</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
