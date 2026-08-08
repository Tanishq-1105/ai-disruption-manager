import express from 'express';
import { config } from './config.js';
import healthRouter from './routes/health.js';
import searchRouter from './routes/search.js';
import simulatorRouter from './routes/simulator.js';

const app = express();
app.use(express.json());

app.use('/health', healthRouter);
app.use('/search', searchRouter);
app.use('/simulator', simulatorRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(config.port, () => {
  console.log(`Travel-Disruption Concierge backend listening on :${config.port}`);
});
