

async function testLiveGroq() {
  const url = 'http://localhost:8000/v1/guidance/recommend';
  const reqSkin = {
    customerId: 'test-user-skin',
    profile: {
      skinType: 'dry',
      concerns: ['hydration', 'aging']
    },
    chatHistory: []
  };

  const reqHair = {
    customerId: 'test-user-hair',
    profile: {
      skinType: 'normal',
      concerns: ['frizz', 'hair care']
    },
    chatHistory: []
  };

  console.log("Testing Skin Routine...");
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqSkin)
    });
    const data = await res.json();
    console.log("Skin Response:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Skin error:", err);
  }

  console.log("Testing Hair Routine...");
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqHair)
    });
    const data = await res.json();
    console.log("Hair Response:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Hair error:", err);
  }
}

testLiveGroq();
