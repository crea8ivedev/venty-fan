(function() {
  const details = document.getElementById('Details-HeaderMenu-1');
  if (!details) return;

  // Force open
  details.setAttribute('open', 'true');
  details.open = true;

  // Prevent closing on toggle
  details.addEventListener('toggle', function(e) {
    if (!details.open) {
      details.setAttribute('open', 'true');
      details.open = true;
    }
  });

  // Prevent summary click from closing it
  const summary = details.querySelector('summary');
  if (summary) {
    summary.addEventListener('click', function(e) {
      e.preventDefault();
    });
  }

  // Prevent any outside click / blur from closing it
  document.addEventListener('click', function(e) {
    if (!details.open) {
      details.setAttribute('open', 'true');
      details.open = true;
    }
  });

})();