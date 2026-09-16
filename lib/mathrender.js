(function () {
    function escapeHtmlStr(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function latexToHtml(tex) {
        let s = escapeHtmlStr(tex);
        s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)');
        s = s.replace(/\\(?:text|mathrm|mathbf|mathit|mathcal|operatorname)\s*\{([^{}]*)\}/g, '$1');
        const sym = {
            '\\cdot':'·','\\times':'×','\\div':'÷','\\pm':'±','\\mp':'∓',
            '\\le':'≤','\\leq':'≤','\\ge':'≥','\\geq':'≥','\\neq':'≠','\\ne':'≠',
            '\\to':'→','\\rightarrow':'→','\\leftarrow':'←','\\Rightarrow':'⇒','\\iff':'⇔',
            '\\infty':'∞','\\in':'∈','\\notin':'∉','\\subset':'⊂','\\subseteq':'⊆',
            '\\cup':'∪','\\cap':'∩','\\forall':'∀','\\exists':'∃','\\emptyset':'∅',
            '\\ldots':'…','\\dots':'…','\\cdots':'⋯','\\equiv':'≡','\\approx':'≈','\\sim':'∼',
            '\\sum':'∑','\\prod':'∏','\\int':'∫','\\sqrt':'√','\\partial':'∂','\\nabla':'∇',
            '\\alpha':'α','\\beta':'β','\\gamma':'γ','\\delta':'δ','\\epsilon':'ε','\\varepsilon':'ε',
            '\\zeta':'ζ','\\eta':'η','\\theta':'θ','\\kappa':'κ','\\lambda':'λ','\\mu':'μ',
            '\\nu':'ν','\\xi':'ξ','\\pi':'π','\\rho':'ρ','\\sigma':'σ','\\tau':'τ',
            '\\phi':'φ','\\varphi':'φ','\\chi':'χ','\\psi':'ψ','\\omega':'ω',
            '\\Gamma':'Γ','\\Delta':'Δ','\\Theta':'Θ','\\Lambda':'Λ','\\Pi':'Π','\\Sigma':'Σ','\\Phi':'Φ','\\Omega':'Ω',
            '\\bmod':'mod','\\mod':'mod','\\gcd':'gcd','\\log':'log','\\ln':'ln','\\lg':'lg',
            '\\min':'min','\\max':'max','\\deg':'deg','\\dim':'dim',
            '\\lfloor':'⌊','\\rfloor':'⌋','\\lceil':'⌈','\\rceil':'⌉','\\langle':'⟨','\\rangle':'⟩',
            '\\,':' ','\\;':' ','\\:':' ','\\!':'','\\quad':'  ','\\qquad':'    '
        };
        s = s.replace(/\\[a-zA-Z]+|\\[,;:!]/g, m => (sym[m] !== undefined ? sym[m] : ''));
        s = s.replace(/\\%/g, '%').replace(/\\_/g, '_').replace(/\\&/g, '&amp;').replace(/\\#/g, '#');
        s = s.replace(/\^\{([^{}]*)\}/g, '<sup>$1</sup>');
        s = s.replace(/\^([A-Za-z0-9])/g, '<sup>$1</sup>');
        s = s.replace(/_\{([^{}]*)\}/g, '<sub>$1</sub>');
        s = s.replace(/_([A-Za-z0-9])/g, '<sub>$1</sub>');
        s = s.replace(/[{}]/g, '');
        return s;
    }

    function convertMathText(text) {
        if (text.indexOf('$') === -1) return null;
        const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
        let out = '', last = 0, m, found = false;
        while ((m = re.exec(text)) !== null) {
            found = true;
            out += escapeHtmlStr(text.slice(last, m.index));
            const tex = m[1] != null ? m[1] : m[2];
            out += '<span class="math">' + latexToHtml(tex) + '</span>';
            last = re.lastIndex;
        }
        if (!found) return null;
        out += escapeHtmlStr(text.slice(last));
        return out;
    }

    function renderMathInElement(root) {
        if (!root || typeof document === 'undefined') return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue || node.nodeValue.indexOf('$') === -1) return NodeFilter.FILTER_REJECT;
                let p = node.parentNode;
                while (p && p !== root) {
                    const tag = p.nodeName;
                    if (tag === 'CODE' || tag === 'PRE' || tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
                    p = p.parentNode;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        const targets = [];
        let n;
        while ((n = walker.nextNode())) targets.push(n);
        targets.forEach(node => {
            const html = convertMathText(node.nodeValue);
            if (html == null) return;
            const span = document.createElement('span');
            span.innerHTML = html;
            node.parentNode.replaceChild(span, node);
        });
    }

    window.renderMathInElement = renderMathInElement;
})();
