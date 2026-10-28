import { Router } from 'express';
import { z } from 'zod';
import { getDishReferences } from '../shared/dishReferences.js';

export function dishReferencesRouter() {
  const router = Router();
  router.get('/dish-references', (req, res) => {
    const name = z.string().trim().max(120).parse(req.query.name ?? '');
    res.json({ data: { name, groups: getDishReferences(name) } });
  });
  return router;
}
