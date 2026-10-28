/**
 * The helper imports the API's no-submit guard so the rule has exactly one
 * definition. Nothing in this package is allowed to click a submission control.
 */
export {
  SAFETY_POLICY,
  SUBMIT_GUARD_CODE,
  SubmitGuardError,
  assertNotFinalSubmission,
  classifyControl,
  isFinalSubmissionControl,
  normalizeControlLabel,
  partitionControls,
} from "../../../server/src/services/autofill/safety.js";
