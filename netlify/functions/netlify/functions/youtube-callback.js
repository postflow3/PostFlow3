exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const error = params.error;
  const code = params.code;

  if (error) {
    return {
      statusCode: 400,
      headers: {
        "Content-Type": "text/html; charset=utf-8"
      },
      body: "<h1>Autorização cancelada ou recusada</h1><p>Volte ao PostFlow 3 e tente novamente.</p>"
    };
  }

  if (!code) {
    return {
      statusCode: 400,
      body: "Código de autorização ausente."
    };
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8"
    },
    body: "<h1>Retorno do Google recebido</h1><p>A etapa seguinte será concluir a troca do código por tokens de acesso no servidor.</p>"
  };
};
