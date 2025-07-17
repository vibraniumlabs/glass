const express = require('express');
const axios = require('axios');
const app = express();
const port = 3000;

const PAYMENT_SERVICE_URL = 'http://localhost:3001/pay';

app.get('/checkout', async (req, res) => {
  console.log('Checkout service received a request...');
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer super-secret-value-123'
    };

    await axios.post(PAYMENT_SERVICE_URL, {}, { headers });

    console.log('...Payment service call successful.');
    res.status(200).send('<h1>Checkout Complete!</h1><p>Your payment was successful.</p>');
  } catch (error) {
    console.error('...Error calling payment service:', error.response ? `${error.response.status} ${error.response.statusText}`: error.message);
    const statusCode = error.response ? error.response.status : 500;
    res.status(502).send(`<h1>502 Bad Gateway</h1><p>The payment service returned a ${statusCode} error. Check the logs.</p>`);
  }
});

app.listen(port, () => {
  console.log(`(Checkout Service) listening on http://localhost:${port}`);
  console.log(`Open http://localhost:${port}/checkout in your browser to start.`);
}); 