{
 "kit_version": "0.1.0",
 "environment": "prod",
 "logged_in": false,
 "what_to_tell_the_user": [
  "Open https://junis.ai/settings/api-keys and sign in (a Junis account is created on first sign-in).",
  "Press \"New Key\", press \"Coding agents (recommended)\", give it a name and create it, then press the copy button next to the new key.",
  "Come back and say it is copied. Do not paste the key into the chat."
 ],
 "then": "Run the connect step (tool: junis_connect). It reads the key from the clipboard, verifies it and stores it locally.",
 "login_url": "https://junis.ai/settings/api-keys",
 "preferred": "Nothing to copy: ask for a key through the browser (tool: junis_connect with method \"browser\"; CLI: `login --browser`). It returns a link where the signed-in user approves; then call it again to finish. Works without a clipboard."
}
