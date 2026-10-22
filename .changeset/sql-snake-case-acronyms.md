---
"@typesugar/sql": patch
---

`toSnakeCase` (and the column names `@derive(Read)`/`@derive(Write)`/`deriveRead` default to)
treats a run of capitals as one word: `"HTMLParser"` is `"html_parser"` and `"userID"` is
`"user_id"`, and so is a plural one: `"userIDs"` is `"user_ids"`, `"imageURLs"` is
`"image_urls"`. Every capital used to get its own underscore (`"_h_t_m_l_parser"`, `"user_i_d"`). The
sql examples run again with the current APIs (`Meta.get`/`put`, `deriveRead` column configs, the
`ConnectionIO` class and `Transactor.fromConnection`, `toQuery()`/`toUpdate()`).
