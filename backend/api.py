# backend/api.py
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
import requests

app = Flask(__name__)
CORS(app)

API_KEY = os.getenv("OPENROUTER_AI_API_KEY")

SYSTEM_PROMPT = {
    "role": "system",
    "content": (
        "You are FitCoach AI, an expert personal fitness coach and nutritionist. "
        "Your goal is to help users build healthy habits, create workout plans, "
        "and reach their fitness goals. Always be encouraging, motivating, and positive. "
        "Ask clarifying questions about the user's fitness level, goals, and any physical "
        "limitations before giving advice. Provide safe, practical recommendations. "
        "If a user describes symptoms of injury or a medical condition, advise them to "
        "consult a healthcare professional. Keep responses clear and concise."
    )
}

@app.route('/api/chat', methods=['POST'])
def chat():
    try:
        # 🔴 Check API key
        if not API_KEY:
            print("ERROR: Missing API key")
            return jsonify({'error': 'Server missing API key'}), 500

        data = request.get_json()

        # 🔴 Validate request
        if not data or 'messages' not in data:
            return jsonify({'error': 'No messages provided'}), 400

        user_messages = data.get('messages', [])
        model = data.get('model', 'openai/gpt-4o-mini')

        messages = [SYSTEM_PROMPT] + user_messages

        # 🔴 Call OpenRouter safely
        try:
            res = requests.post(
                'https://openrouter.ai/api/v1/chat/completions',
                headers={
                    'Authorization': f'Bearer {API_KEY}',
                    'Content-Type': 'application/json'
                },
                json={
                    'model': model,
                    'messages': messages,
                    'max_tokens': 1024
                },
                timeout=15  # shorter timeout prevents frontend hanging
            )
        except requests.exceptions.RequestException as e:
            print("Network error:", e)
            return jsonify({'error': 'Failed to reach AI service'}), 500

        # 🔴 Handle bad response
        if not res.ok:
            try:
                err = res.json()
                message = err.get('error', {}).get('message', 'Unknown error')
            except:
                message = f'HTTP {res.status_code}'

            print("API error:", message)
            return jsonify({'error': message}), res.status_code

        result = res.json()

        # 🔴 Safely extract reply
        reply = (
            result.get('choices', [{}])[0]
            .get('message', {})
            .get('content', '')
        )

        return jsonify({'reply': reply})

    except Exception as e:
        print("SERVER CRASH:", e)
        return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    app.run(port=5000, debug=True)