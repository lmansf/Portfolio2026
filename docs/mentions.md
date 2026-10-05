# Elsewhere / Mentions

The "Elsewhere / Mentions" section on [/about](https://loganmansfield.org/about)
lists talks, guest posts, podcasts and features **about or by Logan published
on other sites**. It is driven entirely by [`data/mentions.json`](../data/mentions.json),
so adding an entry never touches the page layout.

While the list is empty the section stays empty and hidden — not even its
heading is in the page. Only add real, published items — never placeholders.

## Add an entry

Append an object to the `mentions` array (order doesn't matter; the page sorts
newest first):

```json
{
  "mentions": [
    {
      "title": "Exact title of the talk, post, episode or article",
      "outlet": "Where it appeared (publication, podcast, event)",
      "date": "2026-11-04",
      "url": "https://example.com/the-actual-page"
    }
  ]
}
```

| Field    | Required | Notes                                                    |
|----------|----------|----------------------------------------------------------|
| `title`  | yes      | Shown as the link text.                                  |
| `outlet` | yes      | Publication, podcast or event name.                      |
| `date`   | yes      | `YYYY-MM-DD`, or `YYYY-MM` / `YYYY` if the day is unknown. |
| `url`    | yes      | The public page (http/https).                            |

Then validate and commit:

    python3 scripts/seo-check.py

You can edit the file straight from GitHub's web editor; Vercel redeploys on
push and the entry appears on the next page load (the JSON is served with
`must-revalidate`, so there is no stale cache to wait out).

## How it works

`assets/mentions.js` (loaded as `mentions.min.js`) fetches `/data/mentions.json`,
drops malformed entries and, if anything is left, builds the divider, heading
and list inside the empty `<section data-mentions hidden>` on /about and
un-hides it. Entries are rendered with `textContent` (no HTML from the file is
ever injected). It runs
on first load and again on the `page:swap` event that `transition.js` fires
after an in-site page transition.
