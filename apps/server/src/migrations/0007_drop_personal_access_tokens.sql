-- Personal access tokens are gone: agents connect over MCP with OAuth, and the REST API serves the
-- web app's browser session only. Dropping the table ends every token that was issued.
DROP TABLE personal_access_tokens;
