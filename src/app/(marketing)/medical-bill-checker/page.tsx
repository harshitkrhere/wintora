import type { Metadata } from 'next';
import { BillCheckerTool } from '@/components/BillCheckerTool';
import { ToolPage } from '@/components/ToolPage';
import { DISCLAIMERS } from '@/config/disclaimers';

export const metadata: Metadata = {
  title: 'Medical bill checker',
  description:
    'Check whether the line items on a medical bill add up to the stated totals, and spot repeated entries and date problems. Free, no account needed.',
  alternates: { canonical: '/medical-bill-checker' },
};

export default function MedicalBillCheckerPage(): React.ReactElement {
  return (
    <ToolPage
      h1="Check a medical bill"
      directAnswer="Enter the line items and totals printed on your statement, and this tool checks whether they add up, whether any charge is repeated, and whether the dates make sense."
      tool={<BillCheckerTool />}
      appliesTo={[
        'You have a bill or statement from a hospital, clinic, dentist or other provider',
        'The total does not look right, or you cannot tell how it was calculated',
        'You want to check the arithmetic before you pay',
        'You want to know what to ask before you call the billing office',
      ]}
      doesNotApplyTo={[
        'Deciding whether a price is fair or reasonable',
        'Deciding whether a treatment was medically necessary',
        'Telling you what your insurance will cover',
        'Legal advice about a debt, a collection account, or a dispute',
      ]}
      whatToGather={[
        'The statement itself, ideally the itemised version',
        'Your explanation of benefits, if your insurer has sent one',
        'Any earlier statement for the same account, so you can compare balances',
        'The account or statement number, which every letter will need',
      ]}
      steps={[
        {
          title: 'Copy the line items',
          detail:
            'Type each charge and its amount exactly as printed. If your statement only shows a single lump sum, that on its own is worth asking about.',
        },
        {
          title: 'Enter the totals',
          detail:
            'Add the subtotal, any adjustments, any insurance payment, and the amount now due, as they appear on the page.',
        },
        {
          title: 'Run the check',
          detail:
            'The tool compares the sum of the lines against the stated subtotal, reconciles the balance, and looks for repeated entries and dates that cannot be right.',
        },
        {
          title: 'Read the evidence',
          detail:
            'Every finding shows the numbers it is based on. If a finding does not match what you are looking at, it is wrong and you should ignore it.',
        },
        {
          title: 'Ask a question',
          detail:
            'If something does not reconcile, contact the billing office. A short, specific written request works better than a general complaint.',
        },
      ]}
      commonProblems={[
        {
          problem: 'The statement has one line and a large total',
          explanation:
            'A summary statement is not an itemised one. An itemised statement lists each service separately, and asking for one in writing is usually the first useful step.',
        },
        {
          problem: 'The same service appears more than once',
          explanation:
            'Sometimes that is correct: a service genuinely provided twice appears twice. It is worth confirming rather than assuming either way.',
        },
        {
          problem: 'The bill arrived before your insurance finished processing',
          explanation:
            'A statement produced before a claim finishes can show the full charge rather than your share. Comparing it against your explanation of benefits usually clears this up.',
        },
        {
          problem: 'The amounts nearly match but are a few cents apart',
          explanation:
            'Rounding on the statement is a common and harmless cause. The tool reports the exact difference so you can judge whether it matters.',
        },
      ]}
      faq={[
        {
          question: 'Do I need an account?',
          answer:
            'No. The checker runs without one. Nothing you enter is saved. An account is only useful if you want to keep the result, attach documents, or track what you have sent.',
        },
        {
          question: 'Is anything stored?',
          answer:
            'No. The figures are analysed in the request and discarded. If you create an account and save a case, that is the point at which anything is stored, and you can delete it at any time.',
        },
        {
          question: 'Does this tell me whether I am being overcharged?',
          answer:
            'No. It tells you whether the document is internally consistent. Whether a price is reasonable is a different question, and one this tool cannot answer.',
        },
        {
          question: 'Is a mismatch evidence that something is wrong?',
          answer:
            'No. A difference between the lines and the total usually has an ordinary explanation, such as a charge listed on another page or a payment applied after printing. It is a reason to ask a question.',
        },
        {
          question: 'Does an AI decide what is wrong with my bill?',
          answer:
            'No. Every finding comes from fixed arithmetic rules, not a language model. A model is only ever used to reword a finding that the rules already produced, and it cannot add, remove or change a number.',
        },
        {
          question: 'What does the free plan include?',
          answer:
            'One active case, the same analysis engine every paid plan uses, and one request letter per period. Paid plans add volume and workflow, not better answers.',
        },
      ]}
      sources={[]}
      relatedLinks={[
        { href: '/bill-vs-eob', label: 'Compare a bill against an EOB' },
        { href: '/itemized-bill-request', label: 'Request an itemised statement' },
        { href: '/payment-plan-request', label: 'Ask about a payment plan' },
        { href: '/methodology', label: 'How the analysis works, and what it cannot do' },
      ]}
      disclaimer={DISCLAIMERS.ANALYSIS_RESULT}
      lastVerified="2026-09-08"
    />
  );
}
