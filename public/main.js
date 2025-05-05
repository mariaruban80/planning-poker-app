<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Planning Poker</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 0;
      background: #f9f9f9;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 20px;
      background: white;
      border-bottom: 1px solid #ddd;
    }

    .logo {
      display: flex;
      align-items: center;
    }

    .logo img {
      width: 24px;
      height: 24px;
      margin-right: 8px;
    }

    .logo span {
      font-size: 20px;
      font-weight: bold;
    }

    .nav-links {
      display: flex;
      align-items: center;
      gap: 15px;
      font-size: 14px;
    }

    .nav-links a {
      text-decoration: none;
      color: #333;
    }

    .nav-links button {
      border: none;
      background: none;
      font-size: 14px;
      cursor: pointer;
    }

    .nav-icons img {
      width: 20px;
      height: 20px;
      cursor: pointer;
    }

    main {
      display: flex;
      padding: 40px;
      justify-content: space-around;
    }

    .illustration {
      max-width: 40%;
    }

    .session-creator {
      background: white;
      padding: 30px;
      border-radius: 10px;
      box-shadow: 0 4px 10px rgba(0,0,0,0.1);
      width: 400px;
    }

    .session-creator h2 {
      margin-top: 0;
    }

    .form-group {
      margin-bottom: 15px;
    }

    .form-group input {
      width: 100%;
      padding: 8px;
      font-size: 14px;
      margin-top: 5px;
    }

    .radio-group {
      margin-bottom: 10px;
    }

    button.create {
      background-color: #5c8dd6;
      color: white;
      padding: 10px 20px;
      border: none;
      font-size: 16px;
      border-radius: 20px;
      cursor: pointer;
      width: 100%;
    }

    .checkbox {
      margin: 10px 0;
    }

    img.illustration-img {
      max-width: 100%;
    }

    .nav-icons {
      display: flex;
      align-items: center;
      gap: 15px;
    }

    .dropdown {
      border: 1px solid #ccc;
      padding: 2px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    }
  </style>
</head>
<body>

<input type="text" id="nameInput" placeholder="Enter your name" />
<button id="createBtn">Create</button>

<script>
  document.getElementById("createBtn").addEventListener("click", function () {
    const name = document.getElementById("nameInput").value.trim();
    if (name) {
      window.location.href = `index.html?name=${encodeURIComponent(name)}`;
    } else {
      alert("Please enter your name.");
    }
  });
</script>

  <header>
    <div class="logo">
      <img src="spade.png" alt="Spade Logo" />
      <span>Planning Poker</span>
    </div>
    <div class="nav-links">
      <a href="#">WHAT IS PLANNING POKER?</a>
      <a href="#">GUIDE</a>
      <a href="#">EXAMPLES</a>
      <a href="#"><button>➕ NEW SESSION</button></a>
      <a href="#"><button>🧭 JOIN SESSION</button></a>
      <div class="nav-icons">
        <img src="https://cdn-icons-png.flaticon.com/512/25/25231.png" alt="GitHub" />
        <div class="dropdown">US</div>
      </div>
    </div>
  </header>

  <main>
    <div class="illustration">
      <img class="illustration-img" src="https://undraw.co/api/illustrations/0f1e7b18-f728-48bc-9ed0-50d0a01938ce" alt="Team Illustration" />
      <p>
        Free / Open source Planning Poker Web App to estimate user stories for your Agile/Scrum teams. Create a session and invite your team members to estimate user stories efficiently.
      </p>
    </div>

    <div class="session-creator">
      <h2>Create new session</h2>

      <div class="form-group">
        <label>Session name *</label>
        <input type="text" placeholder="Session Name" />
      </div>

      <div class="form-group">
        <label>Your name *</label>
        <input type="text" placeholder="Your Name" />
      </div>

      <div class="radio-group"><input type="radio" name="scale" checked /> Fibonacci (0, 1, 2, 3, 5, 8, 13, 21...)</div>
      <div class="radio-group"><input type="radio" name="scale" /> Short Fibonacci (0, ½, 1, 2, 3...)</div>
      <div class="radio-group"><input type="radio" name="scale" /> T-Shirt (XXS, XS, S, M...)</div>
      <div class="radio-group"><input type="radio" name="scale" /> T-Shirt & Numbers</div>
      <div class="radio-group"><input type="radio" name="scale" /> Custom</div>

      <div class="checkbox">
        <input type="checkbox" /> Allow members to manage session
      </div>

      <button class="create">CREATE</button>
    </div>
  </main>
</body>
</html>
