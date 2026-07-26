import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// GET /api/interests  (oeffentlich)
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, slug, icon FROM interests ORDER BY name',
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
