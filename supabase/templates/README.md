# Auth email templates

The six messages Supabase Auth sends, in the product's look. They are kept
here so the wording is versioned and reviewed like everything else; Supabase
reads them from its dashboard, not from this folder.

To apply: Supabase dashboard -> Authentication -> Email Templates. For each
template, paste the subject below and the file's contents into the body.
`supabase config push` is NOT used for this: config.toml holds local-dev
values (site URL, confirmations, MFA) that would overwrite the hosted ones.

| Template | Subject | File |
| --- | --- | --- |
| Confirm sign up | Confirm your email for Wintora | confirmation.html |
| Reset password | Reset your Wintora password | recovery.html |
| Magic link | Your Wintora sign-in link | magic_link.html |
| Change email address | Confirm your new email address for Wintora | email_change.html |
| Invite user | You have been invited to Wintora | invite.html |
| Reauthentication | Your Wintora confirmation code | reauthentication.html |

The product's own messages (reminders, subscription changes, and so on) use
the same layout from `src/domain/email/layout.ts`, so the two sets match.
