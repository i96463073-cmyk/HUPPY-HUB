let services = [];

const $ = (id) => document.getElementById(id);


async function loadServices() {

  try {

    const response = await fetch("/api/services");
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "Could not load services");
    }

    services = data.services || [];

    const select = $("service");

    if (!services.length) {
      select.innerHTML =
        `<option value="">No services available</option>`;
      return;
    }

    select.innerHTML = services.map(service => {

      return `
        <option value="${escapeHtml(service.service)}">
          ${escapeHtml(service.name)}
          — KES ${escapeHtml(service.rate)}
        </option>
      `;

    }).join("");

    updateService();

  } catch (error) {

    $("service").innerHTML =
      `<option value="">Backend not connected</option>`;

    $("serviceInfo").textContent =
      error.message || "Unable to load services.";

  }
}


function escapeHtml(value) {

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

}


function currentService() {

  return services.find(
    service =>
      String(service.service) ===
      String($("service").value)
  );

}


function updateService() {

  const service = currentService();

  if (!service) return;

  $("quantity").min = service.min || 1;
  $("quantity").max = service.max || 1000000;

  if (
    !$("quantity").value ||
    Number($("quantity").value) < Number(service.min)
  ) {
    $("quantity").value = service.min;
  }

  $("serviceInfo").textContent =
    `${service.category || service.type || "Service"} • ` +
    `Minimum: ${service.min} • ` +
    `Maximum: ${service.max} • ` +
    `Rate: KES ${service.rate} per 1000`;

  calculatePrice();

}


function calculatePrice() {

  const service = currentService();

  if (!service) return;

  const quantity =
    Number($("quantity").value || 0);

  const rate =
    Number(service.rate || 0);

  const total =
    (quantity / 1000) * rate;

  $("total").textContent =
    "KES " + total.toFixed(2);

}


function showMessage(message) {

  $("message").textContent = message;

}


$("service").addEventListener(
  "change",
  updateService
);


$("quantity").addEventListener(
  "input",
  calculatePrice
);


$("payButton").addEventListener(
  "click",
  async () => {

    const service = currentService();

    const quantity =
      Number($("quantity").value);

    const link =
      $("link").value.trim();

    const email =
      $("email").value.trim();

    const phone =
      $("phone").value.trim();

    const amount =
      Number(
        (
          quantity /
          1000 *
          Number(service?.rate || 0)
        ).toFixed(2)
      );


    if (!service) {
      return showMessage(
        "Please select a service."
      );
    }


    if (!link) {
      return showMessage(
        "Please enter the target link."
      );
    }


    if (
      quantity < Number(service.min) ||
      quantity > Number(service.max)
    ) {

      return showMessage(
        `Quantity must be between ${service.min} and ${service.max}.`
      );

    }


    if (!email && !phone) {

      return showMessage(
        "Enter your email or phone number."
      );

    }


    if (amount <= 0) {

      return showMessage(
        "Invalid payment amount."
      );

    }


    const button = $("payButton");

    button.disabled = true;
    button.textContent =
      "Creating PesaPal payment...";


    try {

      const response =
        await fetch(
          "/api/orders",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body: JSON.stringify({

              serviceId:
                service.service,

              link,

              quantity,

              amount,

              firstName:
                $("firstName").value.trim(),

              lastName:
                $("lastName").value.trim(),

              email,

              phone

            })

          }
        );


      const data =
        await response.json();


      if (!response.ok ||
          !data.success) {

        throw new Error(
          data.error ||
          "Could not create payment."
        );

      }


      window.location.href =
        data.paymentUrl;


    } catch (error) {

      showMessage(
        error.message
      );

      button.disabled = false;

      button.textContent =
        "Continue to PesaPal →";

    }

  }
);


$("trackButton").addEventListener(
  "click",
  async () => {

    const orderId =
      $("orderId").value.trim();

    if (!orderId) {

      $("trackingResult").textContent =
        "Enter your order ID.";

      return;

    }


    $("trackingResult").textContent =
      "Checking order...";


    try {

      const response =
        await fetch(
          "/api/orders/" +
          encodeURIComponent(orderId)
        );


      const data =
        await response.json();


      if (!response.ok) {
        throw new Error(
          data.error ||
          "Order not found."
        );
      }


      $("trackingResult").textContent =
        JSON.stringify(
          data.order,
          null,
          2
        );

    } catch (error) {

      $("trackingResult").textContent =
        error.message;

    }

  }
);


$("year").textContent =
  new Date().getFullYear();


loadServices();
