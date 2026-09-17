import { usePageTitle } from '../app/pageTitle'
import { SendMoneyWizard } from '../features/send/SendMoneyWizard'

/**
 * The page heading is for screen readers only: the top bar already shows "Send money", and repeating it on screen
 * would push the form's main action below the fold. It still takes focus on arrival (RouteFocus).
 */
export function SendMoneyPage() {
  usePageTitle('Send money')
  return (
    <>
      <h1 tabIndex={-1} className="sr-only">Send money</h1>
      <SendMoneyWizard />
    </>
  )
}
