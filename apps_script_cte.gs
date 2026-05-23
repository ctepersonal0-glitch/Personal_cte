function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  
  try {
    var action = e.parameter.action;
    var token = e.parameter.token;
    
    if (token !== 'cte-token-seguro-2026') {
      output.setContent(JSON.stringify({ok: false, error: 'Token inválido'}));
      return output;
    }
    
    if (action === 'getUsers') {
      var users = getUsers_();
      output.setContent(JSON.stringify({ok: true, users: users}));
      
    } else if (action === 'saveUsers') {
      var users = JSON.parse(decodeURIComponent(e.parameter.users));
      saveUsers_(users);
      output.setContent(JSON.stringify({ok: true}));
      
    } else if (action === 'getSolicitudes') {
      var sols = getSolicitudes_();
      output.setContent(JSON.stringify({ok: true, solicitudes: sols}));
      
    } else if (action === 'saveSolicitudes') {
      var sols = JSON.parse(decodeURIComponent(e.parameter.solicitudes));
      saveSolicitudes_(sols);
      output.setContent(JSON.stringify({ok: true}));
      
    } else {
      output.setContent(JSON.stringify({ok: false, error: 'Acción desconocida'}));
    }
    
  } catch(err) {
    output.setContent(JSON.stringify({ok: false, error: err.toString()}));
  }
  
  return output;
}
