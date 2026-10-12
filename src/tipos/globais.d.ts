/* =============================================================================
 * PegaVaga - src/tipos/globais.d.ts
 * O contrato que os scripts clássicos compartilham entre si.
 *
 * A extensão NÃO usa módulos ES: cada arquivo é um script que pendura o seu
 * contrato em `globalThis` (é o que o `popup.html`, o content script injetado e o
 * `importScripts` do service worker exigem — e o que mantém os testes de fumaça
 * rodando no Node puro). Como não há `import`, o tipo do que o outro arquivo
 * publica tem de vir de outro lugar: é aqui.
 *
 * O tipo não é escrito à mão. Cada fonte termina com
 *
 *     type PegaVagaXxxApi = typeof apiXxx;
 *     globalThis.PegaVagaXxx = apiXxx;
 *
 * e é esse apelido (derivado do próprio código) que o `declare var` abaixo usa.
 * Assim o `.d.ts` nunca mente sobre o que o arquivo publica: mudou a API do
 * `edicoes.ts`, o tsc acusa na hora — inclusive aqui.
 *
 * `declare var` e não `declare const`: a publicação é uma atribuição em
 * `globalThis`, e só `var` é propriedade do objeto global.
 *
 * Duas regras valem para todos os fontes desta pasta:
 *   1. O nome de todo `var`/`const`/`function` de topo é ÚNICO no projeto — os
 *      scripts dividem o mesmo repositório global, e dois `const` com o mesmo
 *      nome derrubariam a página inteira ("has already been declared").
 *   2. Tipo (interface/type) declarado no topo de um fonte é global de propósito:
 *      é assim que o `shared.ts` usa `PerfilEdicao` sem importar nada.
 * ===========================================================================*/

/** Perfis de edição (`edicoes.js`): política de free e premium, e quem concede. */
declare var PegaVagaEdicoes: PegaVagaEdicoesApi;
