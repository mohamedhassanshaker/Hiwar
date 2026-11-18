import { intakeProfile } from "@/features/requests/service";
import { env } from "@/lib/env";

/**
 * The script an external site loads to offer one request type's form (`UC-30.1-04`).
 *
 * It is generated for one request type, so the snippet a designer copies already names
 * it. The script holds no credentials: the endpoint decides what a visitor may raise, and
 * it draws its fields from the published version rather than from anything the host page
 * says, so a form on a stale page cannot submit a field the type no longer has.
 *
 * The host page chooses where the form goes with
 * `<div data-awp-request-form></div>`; without one the script appends to the body.
 */

export const instant = false;

/**
 * The embeddable form's source for one request type, with its endpoint and titles inlined as JSON
 * literals. In the browser it fetches the type's fields, draws them in the host page's language
 * (Arabic right to left) and posts the submission, showing the new request key or the refusal.
 */
function script(code: string, base: string, title: string, titleAr: string): string {
  return `(function () {
  var endpoint = ${JSON.stringify(`${base}/api/request-widget/${code}`)};
  var lang = (document.documentElement.lang || 'en').slice(0, 2) === 'ar' ? 'ar' : 'en';
  var WORDS = {
    en: { title: ${JSON.stringify(title)}, name: 'Your name', email: 'Your email', summary: 'What do you need?',
          send: 'Submit', sending: 'Submitting…', raised: 'Raised as ', failed: 'Could not submit: ' },
    ar: { title: ${JSON.stringify(titleAr)}, name: 'الاسم', email: 'البريد الإلكتروني', summary: 'ما الذي تحتاجه؟',
          send: 'إرسال', sending: 'جارٍ الإرسال…', raised: 'سُجّل الطلب ', failed: 'تعذّر الإرسال: ' },
  };
  var words = WORDS[lang];

  var host = document.querySelector('[data-awp-request-form]') || document.body.appendChild(document.createElement('div'));
  host.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  host.style.cssText = 'max-width:520px;font:14px system-ui;display:flex;flex-direction:column;gap:12px';

  function field(labelText, input) {
    var label = document.createElement('label');
    label.style.cssText = 'display:flex;flex-direction:column;gap:4px';
    label.appendChild(document.createTextNode(labelText));
    input.style.cssText = 'padding:8px;border:1px solid #d4d4d4;border-radius:8px;font:14px system-ui';
    label.appendChild(input);
    return label;
  }

  /* The field list comes from the published version, never from this page: a form left on
     a site for a year must not post an attribute the request type has since dropped. */
  fetch(endpoint, { headers: { accept: 'application/json' } }).then(function (answer) {
    if (!answer.ok) throw new Error(String(answer.status));
    return answer.json();
  }).then(function (profile) {
    var form = document.createElement('form');
    form.style.cssText = 'display:flex;flex-direction:column;gap:12px';

    var heading = document.createElement('h3');
    heading.textContent = lang === 'ar' ? profile.nameAr || words.title : profile.nameEn || words.title;
    heading.style.cssText = 'margin:0;font:600 18px system-ui';
    form.appendChild(heading);

    var name = document.createElement('input');
    name.required = true;
    form.appendChild(field(words.name, name));

    var email = document.createElement('input');
    email.type = 'email';
    email.required = true;
    form.appendChild(field(words.email, email));

    var summary = document.createElement('textarea');
    summary.required = true;
    summary.rows = 3;
    form.appendChild(field(words.summary, summary));

    var inputs = {};
    (profile.fields || []).forEach(function (one) {
      var input = document.createElement(one.dataType === 'LongText' ? 'textarea' : one.dataType === 'Enum' ? 'select' : 'input');
      if (one.dataType === 'Number' || one.dataType === 'Money') input.type = 'number';
      if (one.dataType === 'Date') input.type = 'date';
      if (one.dataType === 'DateTime') input.type = 'datetime-local';
      if (one.dataType === 'Boolean') input.type = 'checkbox';
      if (one.dataType === 'Enum') {
        input.appendChild(document.createElement('option'));
        (one.enumValues || []).forEach(function (choice) {
          var option = document.createElement('option');
          option.value = choice.value;
          option.textContent = lang === 'ar' ? choice.labelAr : choice.labelEn;
          input.appendChild(option);
        });
      }
      input.required = !!one.required;
      inputs[one.key] = input;
      var text = (lang === 'ar' ? one.labelAr : one.labelEn) + (one.required ? ' *' : '');
      form.appendChild(field(text, input));
    });

    var submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = words.send;
    submit.style.cssText = 'border:0;border-radius:8px;padding:10px 16px;color:#fff;cursor:pointer;background:#12034B;font:500 14px system-ui';
    form.appendChild(submit);

    var said = document.createElement('p');
    said.setAttribute('role', 'status');
    said.style.cssText = 'margin:0;font:14px system-ui';
    form.appendChild(said);

    form.onsubmit = function (event) {
      event.preventDefault();
      submit.disabled = true;
      said.style.color = '#555';
      said.textContent = words.sending;
      var attributes = {};
      Object.keys(inputs).forEach(function (key) {
        attributes[key] = inputs[key].type === 'checkbox' ? String(inputs[key].checked) : inputs[key].value;
      });
      fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.value, email: email.value, summary: summary.value, attributes: attributes }),
      }).then(function (answer) {
        return answer.json().then(function (body) { return { ok: answer.ok, body: body }; });
      }).then(function (result) {
        submit.disabled = false;
        if (result.ok) {
          said.style.color = '#0a7';
          said.textContent = words.raised + result.body.key;
          form.reset();
          return;
        }
        said.style.color = '#c00';
        said.textContent = words.failed + (result.body.reason || '');
      }).catch(function (problem) {
        submit.disabled = false;
        said.style.color = '#c00';
        said.textContent = words.failed + problem.message;
      });
    };

    host.appendChild(form);
  }).catch(function () {
    /* A form that cannot load its own fields says so rather than drawing an empty one
       somebody would fill in and lose. */
    host.textContent = lang === 'ar' ? 'النموذج غير متاح حالياً.' : 'This form is not available.';
  });
})();
`;
}

/**
 * Serves the form script for a request type that takes requests from a website, to any origin and
 * uncached; a script comment with 404 for any other type.
 */
export async function GET(_request: Request, context: { params: Promise<{ requestTypeCode: string }> }): Promise<Response> {
  const { requestTypeCode } = await context.params;
  const profile = await intakeProfile(requestTypeCode);
  if (!profile) {
    return new Response("// No such form.", { status: 404, headers: { "content-type": "application/javascript" } });
  }

  return new Response(script(profile.code, env().APP_URL.replace(/\/$/, ""), profile.nameEn, profile.nameAr), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      // The host page is a different origin, and the script is public by design.
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}
