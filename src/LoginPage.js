import React, { useState } from 'react';
import { supabase } from './supabaseClient';

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetMessage, setResetMessage] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError('Invalid email or password');
    }

    setLoading(false);
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setResetMessage('');

    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: window.location.origin,
    });

    if (error) {
      setResetMessage('Error: ' + error.message);
    } else {
      setResetMessage('If that email is registered, a password reset link has been sent.');
    }
  };

  if (showForgot) {
    return (
      <div className="login-container">
        <div className="login-card">
          <img src="/sunnybell-heights-logo.png" alt="Sunnybell Height Concept Ltd" className="login-logo"/>
          <h1>Reset Password</h1>
          <p>Enter your email to receive a reset link</p>

          <form onSubmit={handleForgotPassword}>
            {resetMessage && <div className="login-error">{resetMessage}</div>}

            <div className="login-field">
              <label>Email</label>
              <input
                type="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                required
              />
            </div>

            <button type="submit">Send Reset Link</button>
          </form>

          <button className="link-btn" onClick={() => setShowForgot(false)}>
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <img src="/sunnybell-heights-logo.png" alt="Sunnybell Height Concept Ltd" className="login-logo" />
        <h1>Loan & IOU Portal</h1>
        <p>Log in to continue</p>

        <form onSubmit={handleLogin}>
          {error && <div className="login-error">{error}</div>}

          <div className="login-field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="login-field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Log In'}
          </button>
        </form>

        <button className="link-btn" onClick={() => setShowForgot(true)}>
          Forgot Password?
        </button>
      </div>
    </div>
  );
}

export default LoginPage;
