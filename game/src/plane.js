// Aurora-9: a red STOL tiltrotor, built as a machine, not a box.
// Tapered fuselage sections, high wing with dihedral, twin tilt nacelles
// with prop blur discs, T-tail, fixed gear, nav lights, red/white/blue
// livery stripes. From chase view it must read at 1/4-1/3 of the frame.
import * as THREE from 'three';

function mat(color, rough = 0.45, metal = 0.25) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

export function buildPlane() {
  const g = new THREE.Group();
  const red = mat(0xc22e24);
  const white = mat(0xf2efe8, 0.4, 0.2);
  const navy = mat(0x1e3a5f, 0.5, 0.2);
  const dark = mat(0x23262c, 0.6, 0.4);
  const glass = new THREE.MeshStandardMaterial({ color: 0x101c2c, roughness: 0.15, metalness: 0.6 });

  // fuselage: nose -> mid -> tail taper (3 sections, not one box)
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.35, 2.6, 12), red);
  nose.rotation.x = Math.PI / 2; nose.position.set(0, 0, 3.4);
  const mid = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.15, 3.4, 12), red);
  mid.rotation.x = Math.PI / 2; mid.position.set(0, 0, 0.4);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.35, 3.2, 12), red);
  tail.rotation.x = Math.PI / 2; tail.position.set(0, 0.15, -2.8);
  // white cheatline stripe along the fuselage
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.72, 0.28, 5.6), white);
  stripe.position.set(0, -0.15, 1.2);
  // navy belly stripe
  const belly = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.22, 5.2), navy);
  belly.position.set(0, -0.95, 1.0);
  // canopy glass
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.05, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), glass);
  canopy.scale.set(0.95, 0.62, 1.5);
  canopy.position.set(0, 0.55, 3.1);
  canopy.rotation.x = -0.25;
  g.add(nose, mid, tail, stripe, belly, canopy);

  // high wing with dihedral + rounded tips
  const wingGeo = new THREE.BoxGeometry(13.5, 0.22, 2.1);
  const wing = new THREE.Mesh(wingGeo, white);
  wing.position.set(0, 0.85, 0.6);
  wing.rotation.z = 0.06;
  const tipL = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), red);
  tipL.scale.set(1, 0.22, 1.9); tipL.position.set(-6.75, 1.24, 0.6);
  const tipR = tipL.clone(); tipR.position.x = 6.75; tipR.position.y = 0.46;
  const wingStripe = new THREE.Mesh(new THREE.BoxGeometry(13.5, 0.06, 0.5), navy);
  wingStripe.position.set(0, 0.98, 0.1);
  g.add(wing, tipL, tipR, wingStripe);

  // T-tail: fin + tailplane
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.2, 1.6), red);
  fin.position.set(0, 1.25, -4.2); fin.rotation.x = 0.25;
  const tailplane = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.18, 1.3), white);
  tailplane.position.set(0, 2.3, -4.3);
  g.add(fin, tailplane);

  // twin tilt nacelles + prop blur discs + spinner cones
  const nacelles = [];
  const props = [];
  for (const side of [-1, 1]) {
    const nac = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.62, 2.4, 10), navy);
    body.rotation.x = Math.PI / 2;
    nac.add(body);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 28),
      new THREE.MeshBasicMaterial({
        color: 0xcfd6dd, transparent: true, opacity: 0.16,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    disc.position.z = 1.45;
    const hub = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.9, 10), dark);
    hub.rotation.x = Math.PI / 2; hub.position.z = 1.5;
    nac.add(disc, hub);
    nac.position.set(side * 4.4, 0.85, 0.6);
    g.add(nac);
    nacelles.push(nac);
    props.push(disc);
    // nav light: red left, green right
    const nav = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 6),
      new THREE.MeshBasicMaterial({ color: side < 0 ? 0xff2020 : 0x20ff60 }),
    );
    nav.position.set(side * 6.75, 1.0, 0.6);
    g.add(nav);
  }
  // white tail nav light
  const tailLight = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  tailLight.position.set(0, 0.4, -4.5);
  g.add(tailLight);

  // fixed gear: two mains + nose wheel
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6), dark);
    strut.position.set(side * 1.5, -1.25, 1.4);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10), dark);
    wheel.rotation.z = Math.PI / 2; wheel.position.set(side * 1.5, -1.8, 1.4);
    g.add(strut, wheel);
  }
  const noseStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.0, 6), dark);
  noseStrut.position.set(0, -1.2, 3.6);
  const noseWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 10), dark);
  noseWheel.rotation.z = Math.PI / 2; noseWheel.position.set(0, -1.7, 3.6);
  g.add(noseStrut, noseWheel);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return { group: g, nacelles, props };
}
