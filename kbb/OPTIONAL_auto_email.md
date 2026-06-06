# Optional: send the submission email automatically (Resend)

By default, submitting opens a prefilled email the player taps "send" on.
If you want it to send automatically with no tap, add Resend (free tier: 100 emails/day).

## 1. Get a Resend API key
- Sign up at https://resend.com (free).
- For real deliverability you'd verify a domain, but for testing you can send
  from `onboarding@resend.dev` to your own verified address.
- Copy your API key (starts with `re_`).

## 2. Add it to Vercel
- Vercel → Project → Settings → Environment Variables → add
  `RESEND_API_KEY = re_xxxxx`  (no NEXT_PUBLIC_ prefix — keep it server-side/secret).

## 3. Create the API route
Create `app/api/send/route.js`:

```js
export async function POST(req) {
  const { subject, body } = await req.json();
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Kælles ball og bong <onboarding@resend.dev>",
      to: ["henrik.kalv@gmail.com"],
      subject,
      text: body,
    }),
  });
  if (!r.ok) return new Response(await r.text(), { status: 500 });
  return Response.json({ ok: true });
}
```

## 4. Call it on submit
In `app/page.js`, inside `buildEmail(ts)`, after building `subject` and `body`, add:

```js
fetch("/api/send", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ subject, body }),
}).catch(() => {});
```

Now submitting both locks predictions AND emails Henrik automatically.
(Keep the modal too, as a fallback in case the email fails.)
