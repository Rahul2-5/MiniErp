require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const AppError = require('./utils/AppError');
const errorHandler = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth.routes');
const customerRoutes = require('./routes/customer.routes');
const productRoutes = require('./routes/product.routes');
const enquiryRoutes = require('./routes/enquiry.routes');
const quotationRoutes = require('./routes/quotation.routes');
const salesOrderRoutes = require('./routes/salesOrder.routes');

const app = express();

// Only the frontend origin from .env may call this API from a browser.
app.use(cors({ origin: process.env.CORS_ORIGIN }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api', productRoutes);
app.use('/api/enquiries', enquiryRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/sales-orders', salesOrderRoutes);

// Unknown URL -> JSON 404 like every other error (Express would send HTML by default).
app.use((req, res, next) => {
  next(new AppError(404, 'Route not found'));
});

// Must be registered last so it catches errors from everything above.
app.use(errorHandler);

module.exports = app;
