exports.handler = async (event) => {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const CL_TOKEN = process.env.COURTLISTENER_TOKEN;

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (!ANTHROPIC_KEY || !CL_TOKEN) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "API keys not configured" })
    };
  }

  const query = event.queryStringParameters?.q || "";
  const jurisdiction = event.queryStringParameters?.jurisdiction || "Missouri";

  if (!query) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "No query provided" })
    };
  }

  try {
    // Step 1: Search CourtListener
    const clUrl = `https://www.courtlistener.com/api/rest/v4/search/?q=${encodeURIComponent(query)}&type=o&page_size=10`;
    const clResponse = await fetch(clUrl, {
      headers: { Authorization: `Token ${CL_TOKEN}` }
    });
    const clData = await clResponse.json();
    const cases = clData.results || [];

    if (cases.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ results: [], summary: "No cases found." })
      };
    }

    // Step 2: Ask Claude to filter and encode
    const caseList = cases.map((c, i) =>
      `${i + 1}. ${c.caseName || c.case_name || "Unknown"} | Court: ${c.court || "Unknown"} | Date: ${c.dateFiled || "Unknown"} | Citations: ${c.citeCount || 0}`
    ).join("\n");

    const prompt = `You are a legal research assistant analyzing cases for relevance to a ${jurisdiction} legal query.

Query: "${query}"
Jurisdiction focus: ${jurisdiction}

Cases found:
${caseList}

For each case evaluate:
1. Relevance to the query (0-100)
2. Jurisdiction match (is it ${jurisdiction} state court, relevant federal circuit, or other)
3. Authority level (controlling, persuasive, landmark, or irrelevant)
4. Confidence score (0-100 based on relevance + jurisdiction + citation count)

Return ONLY valid JSON in this exact format, no other text:
{
  "filtered": [
    {
      "index": 1,
      "relevance": 85,
      "jurisdiction_match": "controlling",
      "authority": "controlling",
      "confidence": 88,
      "twist": "S",
      "reason": "Brief explanation"
    }
  ],
  "summary": "2-3 sentence summary of what was found"
}

Only include cases with relevance above 40. Set twist to S for confidence above 65, Z for 40-65.`;

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const claudeData = await claudeResponse.json();
    const claudeText = claudeData.content?.[0]?.text || "{}";

    let parsed;
    try {
      const clean = claudeText.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = { filtered: [], summary: "Could not parse results." };
    }

    // Step 3: Merge Claude encoding with CourtListener data
    const enriched = (parsed.filtered || []).map(item => {
      const original = cases[item.index - 1];
      return {
        caseName: original?.caseName || original?.case_name || "Unknown",
        court: original?.court || "Unknown",
        dateFiled: original?.dateFiled || original?.date_filed || "Unknown",
        url: original?.url || "",
        citeCount: original?.citeCount || 0,
        confidence: item.confidence,
        authority: item.authority,
        twist: item.twist,
        reason: item.reason,
        jurisdiction_match: item.jurisdiction_match
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        results: enriched,
        summary: parsed.summary || "",
        total_found: clData.count || 0,
        filtered_count: enriched.length
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};