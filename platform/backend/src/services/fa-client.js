/** Legacy import compatibility only. This application runs entirely without FA.
 * Old environment variables must never enable external calls or paid actions.
 * Keep these exports while legacy routes/data are migrated to our own services.
 */
export const faAvailable = () => false;
export const faImagesAvailable = () => false;
async function disabled() {
  throw Object.assign(new Error('FA отключён. Используйте собственный движок Bananabun.'), {
    statusCode: 410, code: 'FA_DISABLED',
  });
}
export const faTool = disabled;
export const faAct = disabled;
export const faScrapeProducts = disabled;
export const faGetProduct = disabled;
export const faStartGeneration = disabled;
export const faGetCreative = disabled;
export const faPollGeneration = disabled;
export const faDownloadImage = disabled;
export const faCreativeSpend = disabled;
export const faCreativeOptions = disabled;
export const faLandingFunnel = disabled;
export const faLandingBehavior = disabled;
export const faAnalyticsQuery = disabled;
export const faListProductSearches = disabled;
export const faListLandingTemplates = disabled;
export const faCampaignHistory = disabled;
export const faGetCampaignAds = disabled;
export const faApplyAdSettings = disabled;
export const faSetTargeting = disabled;
export const faBulkEdit = disabled;
export const faDuplicate = disabled;
export const faRename = disabled;
export const faSetBudget = disabled;
export const faPreparePush = disabled;
export const faPushTrace = disabled;
export const faFindSimilarProducts = disabled;
export const faCheckProfile = disabled;
