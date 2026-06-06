import assert from "node:assert/strict";
import test from "node:test";

import { detectArticleLanguage } from "../src/background/articleExtractor.js";
import { buildMessages } from "../src/background/openaiClient.js";

test("detectArticleLanguage prefers page lang metadata", () => {
  const doc = {
    documentElement: { lang: "es-ES" },
    querySelector() {
      return null;
    },
  };

  assert.equal(detectArticleLanguage(doc), "es-es");
});

test("detectArticleLanguage falls back to language meta tags", () => {
  const doc = {
    documentElement: { lang: "" },
    querySelector(selector) {
      if (selector === 'meta[http-equiv="content-language"]') {
        return { getAttribute: () => "fr-FR" };
      }

      return null;
    },
  };

  assert.equal(detectArticleLanguage(doc), "fr-fr");
});

test("buildMessages asks for a title in the article language", () => {
  const [system, user] = buildMessages("texto del artículo", "Titular", "es", 120);

  assert.match(system.content, /same language as the article/i);
  assert.match(system.content, /unknown/i);
  assert.match(user.content, /Article language: es/);
});
