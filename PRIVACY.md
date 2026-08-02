# Privacy Policy

**Last updated: 1 August 2026**

This policy covers the Nexus iOS application and its backend.

> **Template, not legal advice.** This document must be reviewed by your
> institution's privacy office or counsel, and the bracketed placeholders
> completed, before the app is submitted to the App Store or used with patient
> data. Publishing it unedited would misdescribe your actual practices.

---

## Who We Are

Nexus is operated by [OPERATOR LEGAL ENTITY], contactable at
[PRIVACY CONTACT EMAIL].

## What This App Is

Nexus estimates apparent facial change between two photographs taken at
different times, producing measures such as predicted facial age, wrinkle
severity by anatomic region, and perceived volume and jawline definition.

**It is not a medical device.** It has no regulatory clearance, is not
validated for diagnosis or treatment, and its outputs are model estimates of
appearance rather than measurements of tissue or clinical outcome.

## What We Collect

**Photographs you provide.** Facial images you capture or import. These are the
core of the service and are inherently sensitive.

**Derived images.** Every photograph is de-identified on-device before upload:
face detection crops the image to an oval and masks the eyes. A standardized
512×512 version is produced for analysis.

**Analysis results.** Numeric scores derived from your photographs.

**Account information.** When you sign in with Apple we receive a stable
identifier and, if you allow it, your name and email address. Apple's Private
Relay option lets you withhold your real address; we support it.

**Labels you enter.** Any subject code, site code, or timing information you
attach to a photograph. **Do not enter names, medical record numbers, or dates
of service.** Use opaque study codes.

**Technical data.** Session tokens, expiry, and the device user-agent string.

We do **not** collect location, contacts, advertising identifiers, or usage
analytics, and there is no third-party tracking.

## What We Do Not Infer

We do not record or infer race or ethnicity. The face detection service does
not report it, so any such value would be fabricated. Where gender or age range
cannot be determined with confidence, the field reads N/A rather than being
guessed.

## How Photographs Are Handled

1. **De-identification happens on your device**, before anything is
   transmitted. There is no remote fallback: an image that cannot be
   de-identified locally is never uploaded.
2. **The de-identified, standardized image** is sent to our backend for
   analysis and stored with your account.
3. **Analysis** is performed by Anthropic's Claude API. Only the
   de-identified, standardized image is sent.

> **On the limits of de-identification:** masking eyes and cropping hair is not
> a recognized HIPAA Safe Harbor method. Facial images remain identifiable in
> principle. Treat processed images as identifiable data.

## Third Parties

| Provider | Receives | Purpose |
|---|---|---|
| Anthropic | De-identified standardized images | Scoring against the analysis rubric |
| Apple | Authentication request | Sign in with Apple |
| [HOSTING PROVIDER] | All stored data | Database and application hosting |
| AWS Rekognition (optional) | De-identified standardized images | Gender and age-range estimation; disabled unless configured |

We do not sell your data, and we do not use it for advertising.

## Retention And Deletion

Data is retained until you delete it.

**You can delete your account from inside the app** — Profile → Account →
Delete Account. This permanently deletes your account and every photograph,
study, and analysis stored with it, cascading through our database. It cannot
be undone.

Individual photographs can be deleted at any time from the gallery.

Backups may retain deleted content for up to [RETENTION WINDOW] before being
overwritten.

## Security

Session tokens are random, server-issued, and stored only as a SHA-256 hash on
our servers. On your device they are held in the iOS Keychain. Transport is
encrypted with TLS. Tokens expire after 30 days and can be revoked by logging
out.

## Your Rights

Depending on where you live you may have rights to access, correct, export, or
erase your data, and to object to processing. Contact
[PRIVACY CONTACT EMAIL]. Account deletion in the app satisfies erasure.

## Clinical And Research Use

If you use Nexus with photographs of other people:

- You are the data controller for those images.
- You are responsible for obtaining informed consent, and for IRB or ethics
  approval where the use is research.
- **This app is not covered by a Business Associate Agreement by default.** If
  you are a HIPAA covered entity, do not upload PHI unless you have executed
  the necessary agreements with the operator and every downstream provider
  listed above.

## Children

Nexus is not directed to children under 13 and we do not knowingly collect
their data.

## Changes

Material changes will be reflected in the "Last updated" date above and, where
required, notified in-app.

## Contact

[PRIVACY CONTACT EMAIL]
[OPERATOR LEGAL ENTITY]
[POSTAL ADDRESS]
