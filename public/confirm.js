// Pide confirmación antes de acciones destructivas (borrar evento o comentario).
document.addEventListener('submit', function (event) {
  var button = event.submitter || event.target.querySelector('[data-confirm]');
  var message = button && button.getAttribute('data-confirm');
  if (message && !window.confirm(message)) event.preventDefault();
});
