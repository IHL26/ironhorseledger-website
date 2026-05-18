exports.handler = async (event) => {
  const TOKEN = process.env.COURTLISTENER_TOKEN;
  
  if (!TOKEN) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "API token not configured" })
    };
  }

  const query = event.queryStringParameters?.q || "";
  const pageSize = event.queryStringParameters?.page_size || "5";

  const url = `https://www.courtlistener.com/api/rest/v4/search/?q=${encodeURIComponent(query)}&type=o&page_size=${pageSize}`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Token ${TOKEN}` }
    });
    const data = await response.json();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};