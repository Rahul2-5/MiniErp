import { useEffect, useState } from 'react';
import api, { errorMessage } from '../api';
import { useAuth } from '../AuthContext';
import { money } from '../format';

export default function SalesOrders() {
  const { user } = useAuth();
  // Hiding buttons is only UX. The backend rejects SALES users with 403 anyway.
  const isAdmin = user.role === 'ADMIN';

  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // The small dispatch form: which order it is for, plus its fields.
  const [dispatchOrder, setDispatchOrder] = useState(null);
  const [vehicleNo, setVehicleNo] = useState('');
  const [driverName, setDriverName] = useState('');

  // New physical stock typed by the admin, by product id. A product not in here shows its saved value.
  const [stockEdits, setStockEdits] = useState({});

  async function loadData() {
    const [orderResponse, productResponse] = await Promise.all([api.get('/sales-orders'), api.get('/products')]);
    setOrders(orderResponse.data);
    setProducts(productResponse.data);
  }

  // Runs an action and shows the backend's error message if it fails (e.g. "Insufficient stock for ...").
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

  function confirmOrder(order) {
    run(async () => {
      await api.post(`/sales-orders/${order.id}/confirm`);
      setMessage(`${order.order_no} confirmed: stock reserved`);
      await loadData();
    });
  }

  function cancelOrder(order) {
    run(async () => {
      await api.post(`/sales-orders/${order.id}/cancel`);
      setMessage(`${order.order_no} cancelled`);
      await loadData();
    });
  }

  function dispatchSelectedOrder(event) {
    event.preventDefault();
    run(async () => {
      const { data } = await api.post(`/sales-orders/${dispatchOrder.id}/dispatch`, {
        vehicle_no: vehicleNo,
        driver_name: driverName,
      });
      setMessage(`${data.order_no} dispatched (${data.dispatch.dispatch_no})`);
      setDispatchOrder(null);
      setVehicleNo('');
      setDriverName('');
      await loadData();
    });
  }

  function saveStock(product) {
    run(async () => {
      try {
        await api.patch(`/inventory/${product.id}`, { physical_qty: Number(stockEdits[product.id]) });
        setMessage(`Stock of ${product.code} updated`);
        await loadData();
      } finally {
        // Saved or refused, the box goes back to showing the real stock (the error banner explains a refusal).
        setStockEdits((edits) => ({ ...edits, [product.id]: undefined }));
      }
    });
  }

  return (
    <div>
      <h2>Sales Orders</h2>
      {error && <div className="banner error">{error}</div>}
      {message && <div className="banner success">{message}</div>}

      {dispatchOrder && (
        <form className="card" onSubmit={dispatchSelectedOrder}>
          <h3>Dispatch {dispatchOrder.order_no}</h3>
          <div className="row">
            <input placeholder="Vehicle no" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} required />
            <input placeholder="Driver name" value={driverName} onChange={(e) => setDriverName(e.target.value)} required />
            <button type="submit">Dispatch</button>
            <button type="button" className="secondary" onClick={() => setDispatchOrder(null)}>Close</button>
          </div>
        </form>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Order no</th>
              <th>Customer</th>
              <th>Quotation</th>
              <th>Items (available now)</th>
              <th>Total</th>
              <th>Status</th>
              {isAdmin && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>{order.order_no}</td>
                <td>{order.customer.company_name}</td>
                <td>{order.quotation.quotation_no}</td>
                <td>
                  {order.items.map((item) => (
                    <div key={item.id}>
                      {item.product.code} x {item.quantity} (available {item.available_qty})
                    </div>
                  ))}
                </td>
                <td>{money(order.total_amount)}</td>
                <td>
                  <span className={`badge ${order.status}`}>{order.status}</span>
                  {order.dispatch && <div>{order.dispatch.dispatch_no} / {order.dispatch.vehicle_no}</div>}
                </td>
                {isAdmin && (
                  <td className="actions">
                    {order.status === 'PENDING' && <button onClick={() => confirmOrder(order)}>Confirm</button>}
                    {order.status === 'CONFIRMED' && <button onClick={() => setDispatchOrder(order)}>Dispatch</button>}
                    {(order.status === 'PENDING' || order.status === 'CONFIRMED') && (
                      <button className="danger" onClick={() => cancelOrder(order)}>Cancel</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Inventory</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Physical</th>
              <th>Reserved</th>
              <th>Available</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td>{product.code}</td>
                <td>{product.name}</td>
                <td>
                  {isAdmin ? (
                    <span className="row">
                      <input
                        type="number"
                        min="0"
                        value={stockEdits[product.id] ?? product.inventory.physical_qty}
                        onChange={(e) => setStockEdits({ ...stockEdits, [product.id]: e.target.value })}
                      />
                      {stockEdits[product.id] !== undefined && <button onClick={() => saveStock(product)}>Save</button>}
                    </span>
                  ) : (
                    product.inventory.physical_qty
                  )}
                </td>
                <td>{product.inventory.reserved_qty}</td>
                <td>{product.inventory.available_qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
