import { Router } from 'express';
import {
  getScore,
  updateScore,
  getScoreBreakdown,
  getOnChainScoreHistory,
  getRemittanceNft,
} from '../controllers/scoreController.js';
import { validate } from '../middleware/validation.js';
import {
  getRemittanceNftSchema,
  getScoreHistorySchema,
  getScoreSchema,
  updateScoreSchema,
} from '../schemas/scoreSchemas.js';
import { requireApiKey } from '../middleware/auth.js';
import { auditLog } from '../middleware/auditLog.js';
import { scoreUpdateRateLimit } from '../middleware/rateLimitMiddleware.js';
import {
  requireJwtAuth,
  requireScopes,
  requireWalletParamMatchesJwt,
} from '../middleware/jwtAuth.js';

const router = Router();

// `POST /score/update` is a privileged action — adjusting a credit score — and it is reached
// with an admin API key rather than through the admin router, so it would otherwise be the one
// privileged write with no record. Mounted on the router so the reads below pass through
// untouched and any mutating route added later is covered by construction. See auditPolicy.ts.
router.use(auditLog);

/**
 * @swagger
 * /score/{userId}:
 *   get:
 *     summary: Retrieve a user's credit score
 *     description: >
 *       Returns the current credit score for the authenticated wallet only:
 *       `userId` must match the Stellar public key in the JWT.
 *     tags: [Score]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: Must equal the JWT wallet (`publicKey`)
 *     responses:
 *       200:
 *         description: Score retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserScore'
 *       400:
 *         description: Invalid user ID.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: userId does not match the authenticated wallet.
 */
router.get(
  '/:userId',
  requireJwtAuth,
  requireScopes('read:score'),
  requireWalletParamMatchesJwt('userId'),
  validate(getScoreSchema),
  getScore,
);

/**
 * @swagger
 * /score/{walletAddress}/history:
 *   get:
 *     summary: Retrieve a user's on-chain credit score history
 *     description: >
 *       Queries the RemittanceNFT contract for the score history vector and
 *       returns a chronologically sorted timeline. Cached for 60 seconds to
 *       avoid spamming the Soroban RPC.
 *     tags: [Score]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: Must equal the JWT wallet (`publicKey`)
 *     responses:
 *       200:
 *         description: Score history retrieved successfully.
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: walletAddress does not match the authenticated wallet.
 */
router.get(
  '/:walletAddress/history',
  requireJwtAuth,
  requireScopes('read:score'),
  requireWalletParamMatchesJwt('walletAddress'),
  validate(getScoreHistorySchema),
  getOnChainScoreHistory,
);

router.get(
  '/:walletAddress/nft',
  requireJwtAuth,
  requireScopes('read:score'),
  requireWalletParamMatchesJwt('walletAddress'),
  validate(getRemittanceNftSchema),
  getRemittanceNft,
);

/**
 * @swagger
 * /score/{userId}/breakdown:
 *   get:
 *     summary: Get a detailed credit score breakdown
 *     description: >
 *       Returns the user's credit score along with a detailed breakdown of
 *       contributing factors (repayment history, streaks, defaults) and a
 *       score history timeline. Derived from loan_events and scores tables.
 *       `userId` must match the Stellar public key in the JWT.
 *     tags: [Score]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: Must equal the JWT wallet (`publicKey`)
 *     responses:
 *       200:
 *         description: Score breakdown retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ScoreBreakdownResponse'
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: userId does not match the authenticated wallet.
 */
router.get(
  '/:userId/breakdown',
  requireJwtAuth,
  requireScopes('read:score'),
  requireWalletParamMatchesJwt('userId'),
  validate(getScoreSchema),
  getScoreBreakdown,
);

/**
 * @swagger
 * /score/update:
 *   post:
 *     summary: Update a user's credit score based on repayment history
 *     description: >
 *       Adjusts the user's credit score by +15 for on-time repayments or
 *       −30 for late payments. Requires an `admin:loans` scoped API key or a
 *       legacy internal API key.
 *     tags: [Score]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - repaymentAmount
 *               - onTime
 *             properties:
 *               userId:
 *                 type: string
 *               repaymentAmount:
 *                 type: number
 *                 example: 500
 *               onTime:
 *                 type: boolean
 *                 example: true
 *     responses:
 *       200:
 *         description: Score updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ScoreUpdateResponse'
 *       400:
 *         description: Validation error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorised — missing or invalid API key.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  '/update',
  requireApiKey('admin:loans'),
  scoreUpdateRateLimit,
  validate(updateScoreSchema),
  updateScore,
);

export default router;
