// Tema escolhido nos Ajustes (claro/escuro) aplicado antes da primeira pintura; sem escolha, segue o sistema.
// Arquivo separado (não script inline) porque a Central serve CSP script-src 'self'.
try {
  var t = localStorage.getItem('central:tema');
  if (t === 'claro') document.documentElement.dataset.theme = 'light';
  if (t === 'escuro') document.documentElement.dataset.theme = 'dark';
} catch (e) {}
