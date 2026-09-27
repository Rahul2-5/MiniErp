import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { errorMessage } from '../api';

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (user) {
    return <Navigate to="/enquiries" replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    try {
      await login(email, password);
      navigate('/enquiries');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form className="card login" onSubmit={handleSubmit}>
      <h2>Mini ERP Login</h2>
      {error && <div className="banner error">{error}</div>}
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button type="submit">Login</button>
    </form>
  );
}
