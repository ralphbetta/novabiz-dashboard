/**
 * The loading screen while the first page's code downloads on first load (afterwards the router waits on the current
 * page instead). The same markup as the placeholder in index.html, which also holds its styles — they must work before
 * the app's CSS arrives — so React replacing the placeholder with this changes nothing on screen.
 */
export function PageLoading() {
  return (
    <div className="app-loading" data-app-loading role="status">
      <div className="app-loading__inner" aria-hidden="true">
        <span className="app-loading__mark">N</span>
        <p className="app-loading__name">NovaBiz</p>
        <span className="app-loading__track"><span className="app-loading__bar" /></span>
      </div>
      <span className="app-loading__label">Loading NovaBiz…</span>
    </div>
  )
}
