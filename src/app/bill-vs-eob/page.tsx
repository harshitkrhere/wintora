import type { Metadata } from 'next';
import { BillCheckerTool } from '@/components/BillCheckerTool';
import { ToolPage } from '@/components/ToolPage';
import { DISCLAIMERS } from '@/config/disclaimers';

export const metadata: Metadata = {
  title: 'Compare a medical bill with your EOB',
  description:
    'Compare what a provider is billing you against what your explanation of benefits says you owe. Free, no account needed.',
  alternates: { canonical: '/bill-vs-eob' },
};

export default function BillVsEobPage(): React.ReactElement {
  return (
    <ToolPage
      h1="Compare a bill with your explanation of benefits"
      directAnswer="An explanation of benefits is not a bill: it is your insurer telling you what it paid and what it says you owe. Comparing the two documents shows whether the provider is asking for the amount your insurer says is yours."
      tool={<BillCheckerTool showEob />}
      appliesTo={[
        'You have both a provider statement and an explanation of benefits for the same care',
        'The amount the provider is asking for looks higher than your EOB suggests',
        'Your EOB shows the plan paid something, but the statement does not reflect it',
        'You want to check before paying, rather than after',
      ]}
      doesNotApplyTo={[
        'Deciding whether your insurer processed the claim correctly',
        'Interpreting your policy terms, deductible or coinsurance',
        'Appealing a denial, which is a separate process',
        'Situations where you have no insurance involved at all',
      ]}
      whatToGather={[
        'The provider statement, showing the amount now due',
        'The explanation of benefits for the same dates of service',
        'The claim reference from the EOB and the account number from the statement',
        'The dates of service, which is how the two documents are matched',
      ]}
      steps={[
        {
          title: 'Check the dates match',
          detail:
            'Make sure both documents cover the same care. A statement often covers a different span than a single claim, which explains many apparent differences.',
        },
        {
          title: 'Find your responsibility on the EOB',
          detail:
            'Look for patient responsibility, or the equivalent wording. That is the figure your insurer says is yours.',
        },
        {
          title: 'Compare it against the amount due',
          detail:
            'Enter both figures. If the provider is asking for more, the tool says so and by how much.',
        },
        {
          title: 'Check the plan payment appears',
          detail:
            'If the EOB shows the plan paid but the statement shows no insurance payment, the statement was probably printed before the payment was applied.',
        },
        {
          title: 'Ask for an updated statement',
          detail:
            'Quote both the claim reference and the account number. Timing differences usually resolve with a corrected statement rather than a dispute.',
        },
      ]}
      commonProblems={[
        {
          problem: 'The statement predates the EOB',
          explanation:
            'This is the single most common cause of a difference. The provider billed before the claim finished processing, and an updated statement usually follows on its own.',
        },
        {
          problem: 'The two documents describe services differently',
          explanation:
            'Providers and insurers often use different wording for the same service. Matching on the procedure code is more reliable than matching on the description.',
        },
        {
          problem: 'One claim covers several statements',
          explanation:
            'If the EOB lists services that are not on this statement, that is usually normal and not a problem in itself.',
        },
        {
          problem: 'The provider is out of network',
          explanation:
            'Amounts can differ substantially for out-of-network care. What applies depends on your policy and on where you live, so ask your insurer to explain the calculation.',
        },
      ]}
      faq={[
        {
          question: 'Is an EOB a bill?',
          answer:
            'No. It is a statement from your insurer explaining how a claim was processed: what was billed, what the plan allowed, what it paid, and what it says is your responsibility. It usually says "this is not a bill" somewhere on it.',
        },
        {
          question: 'What if the bill asks for more than my EOB says I owe?',
          answer:
            'Ask the billing office to review the statement against the EOB, quoting both reference numbers. Timing is the most common cause. If it persists, your insurer can usually explain how your responsibility was calculated.',
        },
        {
          question: 'Does a difference mean someone did something wrong?',
          answer:
            'No. Most differences are timing or wording. This tool points out a difference so you can ask about it, not so you can accuse anyone of anything.',
        },
        {
          question: 'Do I need to upload the documents?',
          answer:
            'Not for this tool. You can type in the two figures. Uploading documents is useful when you want the full line-by-line comparison and a saved record.',
        },
        {
          question: 'Which plans include the full comparison?',
          answer:
            'The basic comparison, which is what this page runs, is on every plan including Free. The advanced line-by-line cross-document analysis is a paid feature. Pricing lists exactly what each plan includes.',
        },
      ]}
      sources={[]}
      relatedLinks={[
        { href: '/medical-bill-checker', label: 'Check a single bill' },
        { href: '/itemized-bill-request', label: 'Request an itemised statement' },
        { href: '/insurance-appeal-template', label: 'If a claim was denied' },
        { href: '/methodology', label: 'How the comparison works' },
      ]}
      disclaimer={DISCLAIMERS.EOB_COMPARISON}
      lastVerified="2026-09-08"
    />
  );
}
