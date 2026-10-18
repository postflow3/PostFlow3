exports.handler = async () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const siteUrl =
    process.env.URL || "https://earnest-panda-af735b.netlify.app";

  if (!clientId) {
    return {
      statusCode: 500,
      body: "Configure GOOGLE_CLIENT_ID nas variáveis de ambiente da Netlify."
    };
  }

  const redirectUri =
    `${siteUrl}/.netlify/functions/youtube-callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    access_type: "offline",
    prompt: "consent"
  });

  return {
    statusCode: 302,
    headers: {
      Location:
        `https://accounts.google.com/o/oauth2/v2/auth?${params}`
    }
  };
};
