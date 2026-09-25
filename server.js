require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();

app.use(express.json());

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


const PORT =
  process.env.PORT || 3000;


const PESAPAL_BASE =
  process.env.PESAPAL_ENV === "sandbox"
    ? "https://cybqa.pesapal.com/pesapalv3"
    : "https://pay.pesapal.com/v3";


const DENZGAINS_URL =
  process.env.DENZGAINS_API_URL ||
  "https://denzgains.com/api/v2";


const orders = new Map();


function createOrderId() {

  return (
    "CC-" +
    Date.now() +
    "-" +
    Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()
  );

}


/* =========================
   PESAPAL TOKEN
========================= */

async function getPesapalToken() {

  const response =
    await fetch(
      PESAPAL_BASE +
      "/api/Auth/RequestToken",
      {
        method: "POST",

        headers: {
          "Accept":
            "application/json",

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({

          consumer_key:
            process.env
              .PESAPAL_CONSUMER_KEY,

          consumer_secret:
            process.env
              .PESAPAL_CONSUMER_SECRET

        })

      }
    );


  const data =
    await response.json();


  if (!response.ok ||
      !data.token) {

    throw new Error(
      data.message ||
      "PesaPal authentication failed."
    );

  }


  return data.token;

}


/* =========================
   GET DENZGAINS SERVICES
========================= */

app.get(
  "/api/services",
  async (req, res) => {

    try {

      const url =
        `${DENZGAINS_URL}` +
        `?action=services` +
        `&key=${encodeURIComponent(
          process.env.DENZGAINS_API_KEY
        )}`;


      const response =
        await fetch(url);


      const data =
        await response.json();


      if (!response.ok) {

        return res.status(502).json({
          success: false,
          error:
            "DenzGains service request failed."
        });

      }


      res.json({
        success: true,
        services: data
      });


    } catch (error) {

      res.status(500).json({
        success: false,
        error: error.message
      });

    }

  }
);


/* =========================
   CREATE PAYMENT
========================= */

app.post(
  "/api/orders",
  async (req, res) => {

    try {

      const {
        serviceId,
        link,
        quantity,
        amount,
        firstName,
        lastName,
        email,
        phone
      } = req.body;


      if (
        !serviceId ||
        !link ||
        !quantity ||
        !amount
      ) {

        return res.status(400).json({
          success: false,
          error:
            "Missing order details."
        });

      }


      const orderId =
        createOrderId();


      orders.set(
        orderId,
        {
          id: orderId,

          serviceId:
            String(serviceId),

          link,

          quantity:
            Number(quantity),

          amount:
            Number(amount),

          paymentStatus:
            "PENDING",

          denzStatus:
            "NOT_SENT"
        }
      );


      const token =
        await getPesapalToken();


      const payload = {

        id: orderId,

        currency: "KES",

        amount:
          Number(amount),

        description:
          `HUPPY HUB Order ${orderId}`,

        callback_url:
          process.env
            .PESAPAL_CALLBACK_URL,

        cancellation_url:
          process.env
            .PESAPAL_CANCEL_URL,

        notification_id:
          process.env
            .PESAPAL_IPN_ID,

        redirect_mode:
          "TOP_WINDOW",

        billing_address: {

          email_address:
            email || "",

          phone_number:
            phone || "",

          country_code:
            "KE",

          first_name:
            firstName || "",

          last_name:
            lastName || ""

        }

      };


      const response =
        await fetch(
          PESAPAL_BASE +
          "/api/Transactions/SubmitOrderRequest",
          {

            method: "POST",

            headers: {

              "Accept":
                "application/json",

              "Content-Type":
                "application/json",

              "Authorization":
                "Bearer " + token

            },

            body:
              JSON.stringify(payload)

          }
        );


      const data =
        await response.json();


      if (
        !response.ok ||
        !data.redirect_url
      ) {

        return res.status(502).json({

          success: false,

          error:
            "PesaPal payment creation failed.",

          details: data

        });

      }


      const order =
        orders.get(orderId);


      order.pesapalTrackingId =
        data.order_tracking_id;


      orders.set(
        orderId,
        order
      );


      res.json({

        success: true,

        orderId,

        paymentUrl:
          data.redirect_url

      });


    } catch (error) {

      console.error(error);

      res.status(500).json({

        success: false,

        error:
          error.message

      });

    }

  }
);


/* =========================
   CHECK PESAPAL STATUS
========================= */

async function getPaymentStatus(
  trackingId
) {

  const token =
    await getPesapalToken();


  const response =
    await fetch(
      PESAPAL_BASE +
      "/api/Transactions/" +
      "GetTransactionStatus" +
      "?orderTrackingId=" +
      encodeURIComponent(trackingId),

      {
        headers: {

          "Accept":
            "application/json",

          "Content-Type":
            "application/json",

          "Authorization":
            "Bearer " + token

        }

      }
    );


  const data =
    await response.json();


  if (!response.ok) {

    throw new Error(
      data.message ||
      "Could not verify payment."
    );

  }


  return data;

}


/* =========================
   SEND PAID ORDER TO DENZGAINS
========================= */

async function sendToDenzGains(
  order
) {

  /*
    IMPORTANT:

    This uses the standard SMM API
    add-order structure:

    action=add
    service=SERVICE ID
    link=TARGET
    quantity=QUANTITY

    Verify the "Create" method on
    your DenzGains API page before
    going live.
  */

  const body =
    new URLSearchParams({

      key:
        process.env
          .DENZGAINS_API_KEY,

      action:
        "add",

      service:
        order.serviceId,

      link:
        order.link,

      quantity:
        String(order.quantity)

    });


  const response =
    await fetch(
      DENZGAINS_URL,
      {

        method: "POST",

        headers: {

          "Content-Type":
            "application/x-www-form-urlencoded"

        },

        body

      }
    );


  const data =
    await response.json();


  return data;

}


/* =========================
   PROCESS PAYMENT
========================= */

async function processPayment(
  merchantReference,
  trackingId
) {

  const order =
    orders.get(
      merchantReference
    );


  if (!order) {

    throw new Error(
      "Order not found."
    );

  }


  const payment =
    await getPaymentStatus(
      trackingId
    );


  const statusCode =
    Number(
      payment.status_code
    );


  if (statusCode !== 1) {

    order.paymentStatus =
      payment.payment_status_description ||
      "PENDING";

    orders.set(
      merchantReference,
      order
    );

    return order;

  }


  order.paymentStatus =
    "COMPLETED";


  /*
    Prevent duplicate DenzGains
    orders if Pesapal sends
    multiple notifications.
  */

  if (!order.denzOrderId) {

    order.denzStatus =
      "SUBMITTING";

    orders.set(
      merchantReference,
      order
    );


    const result =
      await sendToDenzGains(
        order
      );


    if (result &&
        result.order) {

      order.denzOrderId =
        String(result.order);

      order.denzStatus =
        "SUBMITTED";

    } else {

      order.denzStatus =
        "ERROR";

      order.denzError =
        result;

    }

  }


  orders.set(
    merchantReference,
    order
  );


  return order;

}


/* =========================
   PESAPAL IPN
========================= */

app.get(
  "/api/pesapal/ipn",
  async (req, res) => {

    try {

      const trackingId =
        req.query.OrderTrackingId;

      const merchantReference =
        req.query.OrderMerchantReference;


      if (
        !trackingId ||
        !merchantReference
      ) {

        return res.status(400).json({
          status: 500
        });

      }


      await processPayment(
        merchantReference,
        trackingId
      );


      res.json({

        orderNotificationType:
          "IPNCHANGE",

        orderTrackingId:
          trackingId,

        orderMerchantReference:
          merchantReference,

        status: 200

      });


    } catch (error) {

      console.error(error);

      res.status(500).json({

        status: 500,

        message:
          error.message

      });

    }

  }
);


/* =========================
   PESAPAL CALLBACK
========================= */

app.get(
  "/api/pesapal/callback",
  async (req, res) => {

    try {

      const trackingId =
        req.query.OrderTrackingId;

      const merchantReference =
        req.query.OrderMerchantReference;


      if (
        trackingId &&
        merchantReference
      ) {

        await processPayment(
          merchantReference,
          trackingId
        );

      }

    } catch (error) {

      console.error(
        "Callback error:",
        error
      );

    }


    res.redirect(
      "/?order=" +
      encodeURIComponent(
        req.query.OrderMerchantReference ||
        ""
      )
    );

  }
);


/* =========================
   ORDER STATUS
========================= */

app.get(
  "/api/orders/:id",
  (req, res) => {

    const order =
      orders.get(
        req.params.id
      );


    if (!order) {

      return res.status(404).json({

        success: false,

        error:
          "Order not found."

      });

    }


    res.json({

      success: true,

      order

    });

  }
);


/* =========================
   HEALTH CHECK
========================= */

app.get(
  "/health",
  (req, res) => {

    res.json({

      ok: true,

      service:
        "HUPPY HUB"

    });

  }
);


app.listen(
  PORT,
  () => {

    console.log(
      `HUPPY HUB running on port ${PORT}`
    );

  }
);
