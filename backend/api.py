# backend/api.py
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
import requests

app = Flask(__name__)
CORS(app)

API_KEY = os.getenv("OPENROUTER_AI_API_KEY")

@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.json
    messages = data.get('messages', [])
    model = data.get('model', 'openai/gpt-4o-mini')

    res = requests.post(
        'https://openrouter.ai/api/v1/chat/completions',
        headers={
            'Authorization': f'Bearer {API_KEY}',
            'Content-Type': 'application/json'
        },
        json={'model': model, 'messages': messages, 'max_tokens': 1024}
    )

    data = res.json()
    if not res.ok:
        return jsonify({'error': data.get('error', {}).get('message', f'HTTP {res.status_code}')}), res.status_code

    reply = data['choices'][0]['message']['content']
    return jsonify({'reply': reply})

if __name__ == '__main__':
    app.run(port=5000, debug=True)