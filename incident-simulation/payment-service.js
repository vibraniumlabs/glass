const express = require('express');
const app = express();
const port = 3001;

// The one true, secret token.
const API_SECRET_TOKEN = 'Bearer super-secret-value-123';

app.post('/pay', (req, res) => {
  console.log('Payment service received a request...');
  const authToken = req.headers['authorization'];

  if (authToken === API_SECRET_TOKEN) {
    console.log('...Auth token is valid. Payment processed.');
    res.status(200).json({ message: 'Payment successful!' });
  } else {
    console.log(`...Auth token is invalid. Provided: ${authToken}`);
    res.status(401).json({ error: 'Unauthorized' });
  }
});

app.listen(port, () => {
  console.log(`(Payment Service) listening on http://localhost:${port}`);
}); 